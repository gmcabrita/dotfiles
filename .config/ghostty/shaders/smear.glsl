void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    // --------------------------------------------------------------------------------
    // 1. Initialization and Coordinate Adjustment
    // --------------------------------------------------------------------------------
    // Use the fragment coordinate as the pixel position.
    vec2 p = fragCoord;

    // Retrieve current and previous cursor positions.
    vec4 currentCursor = iCursorCurrent;
    vec4 previousCursor = iCursorPrevious;

    // Flip the y-coordinates to account for differing coordinate systems.
    currentCursor.y = iResolution.y - currentCursor.y;
    previousCursor.y = iResolution.y - previousCursor.y;

    // Determine the previous position.
    // If previousCursor.y > 0.0, use the absolute previous xy position; otherwise, default to the current cursor position.
    vec2 prevPos = (previousCursor.y > 0.0) ? abs(previousCursor.xy) : currentCursor.xy;
    vec2 currPos = currentCursor.xy;

    // --------------------------------------------------------------------------------
    // 2. Animation Setup
    // --------------------------------------------------------------------------------
    // Define the fixed duration (in seconds) for the cursor movement animation.
    float fixedDuration = 0.2;

    // Calculate the distance between current and previous positions.
    float distanceBetween = length(currPos - prevPos);

    // Compute the speed based on the distance and fixed duration.
    float speed = distanceBetween / fixedDuration;

    // Compute normalized time factor clamped between 0 and 1.
    float t = clamp((iTime - iTimeCursorChange) / fixedDuration, 0.0, 1.0);
    // Direct linear interpolation ensures that t=1 corresponds to currPos.
    vec2 animatedPos = mix(prevPos, currPos, t);

    // Set up fade parameters for the trail.
    float fadePos = 1.0 - t; // The fade factor decreases as t increases.
    float fadeWidth = 0.1; // Width of the fade transition.

    // --------------------------------------------------------------------------------
    // 3. Cursor Appearance Setup
    // --------------------------------------------------------------------------------
    // Define the size of the cursor.
    vec2 cursorSize = vec2(currentCursor.z, currentCursor.w);
    // Calculate half-size to center the trail properly.
    vec2 halfSize = cursorSize * 0.5;
    // Define an edge smoothing factor.
    float edgeSmoothing = 2.0;

    // Initialize color and alpha accumulators.
    vec3 colorAcc = vec3(0.0);
    float alphaAcc = 0.0;

    // --------------------------------------------------------------------------------
    // 4. Trail Rendering Loop
    // --------------------------------------------------------------------------------
    // Determine the number of steps for drawing the trail.
    // More steps are used when the cursor travels a longer distance.
    int steps = max(10, int(distanceBetween / 5.0));
    for (int i = 0; i < steps; i++) {
        // Calculate the interpolation factor along the trail.
        float fi = float(i) / float(steps - 1);
        // Linearly interpolate between the animated and previous positions.
        vec2 trailPos = mix(animatedPos, prevPos, fi);

        // Adjust the trail position to center it relative to the cursor's dimensions.
        trailPos.y -= halfSize.y;
        trailPos.x += halfSize.x;

        // Compute smooth edge values for x and y directions.
        float xEdge = smoothstep(halfSize.x - edgeSmoothing, halfSize.x, abs(p.x - trailPos.x));
        float yEdge = smoothstep(halfSize.y - edgeSmoothing, halfSize.y, abs(p.y - trailPos.y));

        // Create a fade mask based on the interpolation factor.
        float fadeMask = 1.0 - smoothstep(fadePos - fadeWidth, fadePos, fi);
        // Compute the segment's alpha based on the edge smoothings, trail position, and fade mask.
        float segAlpha = (1.0 - xEdge) * (1.0 - yEdge) * (1.0 - fi) * fadeMask;

        // Accumulate the trail color (using a light blue shade) weighted by the segment's alpha.
        colorAcc += (vec3(68.0, 221.0, 255.0) / 255.0) * segAlpha;
        // Accumulate the overall alpha.
        alphaAcc += segAlpha;
    }

    // --------------------------------------------------------------------------------
    // 5. Final Color Calculation
    // --------------------------------------------------------------------------------
    // Normalize the accumulated color by the total alpha if any alpha was added.
    if (alphaAcc > 0.0) {
        colorAcc /= alphaAcc;
    }

    // Set the output fragment color.
    fragColor = vec4(colorAcc, alphaAcc);
}
