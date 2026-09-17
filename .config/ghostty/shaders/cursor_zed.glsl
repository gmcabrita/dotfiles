// Port of Zed's cursor movement animation to a Ghostty custom shader.
//
// Source: zed-industries/zed PR #63195, crates/editor/src/cursor_animation.rs
// (itself adapted from LengineerC/vscode-neovide-cursor, MIT).
//
// Zed keeps per corner spring state across frames. Ghostty shaders are
// stateless, so this port evaluates the same critically damped spring in
// closed form from (iPreviousCursor, iCurrentCursor, iTime - iTimeCursorChange).
// The closed form is exact for Zed's update() when the spring starts with zero
// velocity, which is the case whenever the previous animation finished before
// the next move. Differences that cannot be reproduced without state:
//
//   1. Zed keeps spring momentum when a retarget happens while a corner with a
//      short animation (<= 0.075 s) is still moving. This port restarts every
//      corner from the previous cursor rectangle with zero velocity.
//   2. Zed retargets from the corner's current animated position. Ghostty only
//      reports the previous settled cursor rectangle.
//   3. Ghostty already painted the static cursor at the target cell. Zed does
//      not paint it while the polygon is animating.
//
// Coordinates: on Metal (macOS) fragCoord has y down and iCurrentCursor.y is
// the bottom edge of the cursor, so this shader works in the same y down frame
// as Zed. On OpenGL (y up) everything mirrors vertically, which only affects
// the tie break between top and bottom corners when ranking trails.

// ---- Zed constants (cursor_animation.rs) -----------------------------------
const float SPRING_RESET_EPSILON = 0.001;
const float SPRING_ACTIVE_EPSILON = 0.01;
const float CORNER_ACTIVE_DISTANCE = 0.5;
const float GEOMETRY_EPSILON = 0.01;
const float SHORT_MOVE_THRESHOLD = 8.0;
const float LEADING_SNAP_THRESHOLD = 0.5;
const float SNAP_ANIMATION_LENGTH_SECONDS = 0.02;
const float ANIMATION_RESET_THRESHOLD_SECONDS = 0.075;
const float MAX_TRAIL_DISTANCE_FACTOR = 100.0;
const vec4 RANK_TRAIL_FACTORS = vec4(1.0, 0.9, 0.5, 0.3);
const float ANIMATION_LENGTH_SECONDS = 0.125;
const float SHORT_ANIMATION_LENGTH_SECONDS = 0.05;
const float TRAIL_SIZE = 1.0;

// Corner order matches Zed: top-left, top-right, bottom-right, bottom-left
// (y down). Order matters: Zed's rank sort is stable, so equal alignments are
// ranked by this index.
const vec2 RELATIVE_POSITIONS[4] = vec2[4](
    vec2(-0.5, -0.5),
    vec2( 0.5, -0.5),
    vec2( 0.5,  0.5),
    vec2(-0.5,  0.5)
);

// AnimationPoint::normalized(): zero vector stays zero instead of NaN.
vec2 safeNormalize(vec2 v) {
    float len = length(v);
    if (len == 0.0 || isinf(len) || isnan(len)) return vec2(0.0);
    return v / len;
}

// Cursor rectangle as Zed's CursorGeometry: origin is the min corner in the
// y down frame, so we convert Ghostty's (left, +Y edge, width, height).
struct Geometry {
    vec2 origin;
    vec2 size;
};

Geometry geometryFromGhostty(vec4 cursor) {
    Geometry g;
    g.size = cursor.zw;
    g.origin = vec2(cursor.x, cursor.y - cursor.w);
    return g;
}

vec2 geometryCenter(Geometry g) {
    return g.origin + g.size * 0.5;
}

// Corner::destination()
vec2 cornerDestination(int i, Geometry g) {
    return geometryCenter(g) + RELATIVE_POSITIONS[i] * g.size;
}

// DampedSpringAnimation::update() applied repeatedly from t = 0 with zero
// initial velocity collapses to this closed form. Returns the remaining
// displacement (target - current) for one axis.
//
// Zed also resets a spring when one frame delta reaches the animation length
// (shortest is 20 ms) and caps frame deltas at 33 ms. Both only matter below
// 50 fps, so they are not emulated here.
float springPosition(float initial, float t, float animationLength) {
    if (abs(initial) < SPRING_RESET_EPSILON) return 0.0;
    if (t <= 0.0) return initial;

    float angularFrequency = 4.0 / animationLength;
    float decay = exp(-angularFrequency * t);
    float position = initial * (1.0 + angularFrequency * t) * decay;
    if (abs(position) < SPRING_RESET_EPSILON) return 0.0;
    return position;
}

// Signed distance to a simple polygon (Inigo Quilez). Handles non convex
// quads, which can appear while corners travel at different speeds.
float sdPolygon(vec2 p, vec2 v[4]) {
    float d = dot(p - v[0], p - v[0]);
    float s = 1.0;
    for (int i = 0, j = 3; i < 4; j = i, i++) {
        vec2 e = v[j] - v[i];
        vec2 w = p - v[i];
        vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
        d = min(d, dot(b, b));
        bvec3 c = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
        if (all(c) || all(not(c))) s = -s;
    }
    return s * sqrt(d);
}

bool styleSupportsAnimation(int style) {
    return style == CURSORSTYLE_BLOCK || style == CURSORSTYLE_BAR;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = texture(iChannel0, fragCoord / iResolution.xy);

    if (iCursorVisible == 0) return;
    if (!styleSupportsAnimation(iCurrentCursorStyle)) return;

    Geometry target = geometryFromGhostty(iCurrentCursor);
    Geometry previous = geometryFromGhostty(iPreviousCursor);

    // CursorGeometry::is_finite() requires positive size. A zero previous
    // rectangle means Ghostty has no prior cursor yet: Zed snaps in that case.
    if (target.size.x <= 0.0 || target.size.y <= 0.0) return;
    if (previous.size.x <= 0.0 || previous.size.y <= 0.0) return;

    // Zed snaps when the geometry changes but the logical (row, column) does
    // not, e.g. block <-> bar toggles or colour changes. Ghostty reports only
    // rectangles, so treat an unchanged left/top edge as the same cell.
    bool sameCell = abs(target.origin.x - previous.origin.x) <= GEOMETRY_EPSILON
        && abs(target.origin.y - previous.origin.y) <= GEOMETRY_EPSILON;
    if (sameCell) return;

    float elapsed = iTime - iTimeCursorChange;

    // ---- CursorAnimationState::retarget() ----------------------------------
    // Corners start snapped to the previous geometry (Corner::snap), so
    // current_position == target_position == previous destination.
    vec2 start[4];
    vec2 destination[4];
    float alignment[4];
    for (int i = 0; i < 4; i++) {
        start[i] = cornerDestination(i, previous);
        destination[i] = cornerDestination(i, target);
        // Corner::direction_alignment()
        vec2 travel = safeNormalize(destination[i] - start[i]);
        vec2 cornerDir = safeNormalize(RELATIVE_POSITIONS[i]);
        alignment[i] = dot(travel, cornerDir);
    }

    // Stable ascending sort by alignment -> rank. rank 0 = most trailing.
    int rank[4];
    for (int i = 0; i < 4; i++) {
        int r = 0;
        for (int j = 0; j < 4; j++) {
            if (alignment[j] < alignment[i] || (alignment[j] == alignment[i] && j < i)) r++;
        }
        rank[i] = r;
    }

    // ---- Corner::retarget() + Corner::update() ------------------------------
    float maxTrailDistance = max(target.size.x, target.size.y) * MAX_TRAIL_DISTANCE_FACTOR;
    vec2 corners[4];
    bool anyCornerActive = false;
    for (int i = 0; i < 4; i++) {
        vec2 jump = (destination[i] - start[i]) / max(target.size, vec2(1.1920929e-7));
        vec2 normalizedJump = safeNormalize(jump);
        vec2 cornerDir = safeNormalize(RELATIVE_POSITIONS[i]);
        float leadingAlignment = dot(normalizedJump, cornerDir);
        bool isShortJump = abs(jump.x) <= SHORT_MOVE_THRESHOLD
            && abs(jump.y) <= SPRING_RESET_EPSILON;

        float baseLength = isShortJump
            ? min(ANIMATION_LENGTH_SECONDS, SHORT_ANIMATION_LENGTH_SECONDS)
            : ANIMATION_LENGTH_SECONDS;
        float referenceLength = leadingAlignment > LEADING_SNAP_THRESHOLD
            ? SNAP_ANIMATION_LENGTH_SECONDS
            : baseLength * RANK_TRAIL_FACTORS[rank[i]];
        float animationLength = baseLength + (referenceLength - baseLength) * TRAIL_SIZE;

        vec2 initial = destination[i] - start[i];
        vec2 position = vec2(
            springPosition(initial.x, elapsed, animationLength),
            springPosition(initial.y, elapsed, animationLength)
        );
        position = clamp(position, vec2(-maxTrailDistance), vec2(maxTrailDistance));

        corners[i] = destination[i] - position;
        anyCornerActive = anyCornerActive
            || abs(position.x) > CORNER_ACTIVE_DISTANCE
            || abs(position.y) > CORNER_ACTIVE_DISTANCE;
    }

    // CursorAnimationState::advance(): once no corner is active Zed snaps and
    // paints the regular cursor, which Ghostty already did.
    if (!anyCornerActive) return;

    // ---- CursorLayout::paint(): fill polygon with the cursor colour ---------
    float d = sdPolygon(fragCoord, corners);
    float coverage = clamp(0.5 - d, 0.0, 1.0);
    vec4 color = iCurrentCursorColor;
    fragColor.rgb = mix(fragColor.rgb, color.rgb, color.a * coverage);
}
