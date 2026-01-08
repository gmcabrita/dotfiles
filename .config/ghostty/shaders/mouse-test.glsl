// Created by inigo quilez - iq/2013
// https://www.youtube.com/c/InigoQuilez
// https://iquilezles.org/

// Shows how to use the mouse input (only left button supported):
//
//      mouse.xy  = mouse position during last button down
//  abs(mouse.zw) = mouse position during last button click
// sign(mouze.z)  = button is down
// sign(mouze.w)  = button is clicked

// See also:
//
// Input - Keyboard    : https://www.shadertoy.com/view/lsXGzf
// Input - Microphone  : https://www.shadertoy.com/view/llSGDh
// Input - Mouse       : https://www.shadertoy.com/view/Mss3zH
// Input - Sound       : https://www.shadertoy.com/view/Xds3Rr
// Input - SoundCloud  : https://www.shadertoy.com/view/MsdGzn
// Input - Time        : https://www.shadertoy.com/view/lsXGz8
// Input - TimeDelta   : https://www.shadertoy.com/view/lsKGWV
// Inout - 3D Texture  : https://www.shadertoy.com/view/4llcR4

float distanceToSegment(vec2 a, vec2 b, vec2 p)
{
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 p = fragCoord / iResolution.x;
    vec2 cen = 0.5 * iResolution.xy / iResolution.x;
    vec4 m = iMouse / iResolution.x;
    m.y = 0.5 - m.y;
    m.w = 0.5 - m.w;

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    if (m.z > 0.0)
    {
        float d = distanceToSegment(m.xy, abs(m.zw), p);
        float effect = 1.0 - smoothstep(.004, 0.008, d);
        col = mix(col, vec3(1.0, 1.0, 0.0), effect);
        alpha = max(alpha, effect);
    }
    if (m.w > 0.0)
    {
        float effect = 1.0 - smoothstep(0.1, 0.105, length(p - cen));
        col = mix(col, vec3(1.0, 1.0, 1.0), effect);
        alpha = max(alpha, effect);
    }

    // Replace circles with rectangles (cursor-like)
    vec2 cursorSize = vec2(0.01, 0.02); // Adjust size as needed
    vec2 cursorPos1 = m.xy + cursorSize * 0.5;
    vec2 cursorPos2 = abs(m.zw) + cursorSize * 0.5;

    if (p.x > cursorPos1.x && p.x < cursorPos1.x + cursorSize.x &&
            p.y > cursorPos1.y && p.y < cursorPos1.y + cursorSize.y)
    {
        col = vec3(1.0, 0.0, 0.0); // Red cursor
        alpha = 1.0;
    }

    if (p.x > cursorPos2.x && p.x < cursorPos2.x + cursorSize.x &&
            p.y > cursorPos2.y && p.y < cursorPos2.y + cursorSize.y)
    {
        col = vec3(0.0, 0.0, 1.0); // Blue cursor
        alpha = 1.0;
    }

    fragColor = vec4(col, alpha);
}
