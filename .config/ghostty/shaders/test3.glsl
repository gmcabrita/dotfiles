// The Universe Within - by Martijn Steinrucken aka BigWings 2018
// Email:countfrolic@gmail.com Twitter:@The_ArtOfCode
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.#define S(a, b, t) smoothstep(a, b, t)


//Modified by Krone to work on ghostty terminal.
// NOTE: mouse interactions do not work.
#define S(a, b, t) smoothstep(a, b, t)
#define NUM_LAYERS 4.

//#define SIMPLE

float N21(vec2 p) {
    vec3 a = fract(vec3(p.xyx) * vec3(213.897, 653.453, 253.098));
    a += dot(a, a.yzx + 79.76);
    return fract((a.x + a.y) * a.z);
}

vec2 GetPos(vec2 id, vec2 offs, float t) {
    float n = N21(id + offs);
    float n1 = fract(n * 10.);
    float n2 = fract(n * 100.);
    float a = t + n;
    return offs + vec2(sin(a * n1), cos(a * n2)) * .4;
}

float GetT(vec2 ro, vec2 rd, vec2 p) {
    return dot(p - ro, rd);
}

float LineDist(vec3 a, vec3 b, vec3 p) {
    return length(cross(b - a, p - a)) / length(p - a);
}

float df_line(in vec2 a, in vec2 b, in vec2 p) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
    return length(pa - ba * h);
}

float line(vec2 a, vec2 b, vec2 uv) {
    float r1 = .04;
    float r2 = .01;

    float d = df_line(a, b, uv);
    float d2 = length(a - b);
    float fade = S(1.5, .5, d2);

    fade += S(.05, .02, abs(d2 - .75));
    return S(r1, r2, d) * fade;
}

float NetLayer(vec2 st, float n, float t) {
    vec2 id = floor(st) + n;

    st = fract(st) - 0.5;

    vec2 p[9];
    int i = 0;
    for (float y = -1.; y <= 1.; y++) {
        for (float x = -1.; x <= 1.; x++) {
            p[i++] = GetPos(id, vec2(x, y), t);
        }
    }

    float m = 0.;
    float sparkle = 0.;

    for (int i = 0; i < 9; i++) {
        m += line(p[4], p[i], st);

        float d = length(st - p[i]);

        float s = (.005 / (d * d));
        s *= S(1., .7, d);
        float pulse = sin((fract(p[i].x) + fract(p[i].y) + t) * 5.) * .4 + .6;
        pulse = pow(pulse, 20.);

        s *= pulse;
        sparkle += s;
    }

    m += line(p[1], p[3], st);
    m += line(p[1], p[5], st);
    m += line(p[7], p[5], st);
    m += line(p[7], p[3], st);

    float sPhase = (sin(t + n) + sin(t * .1)) * .25 + .5;
    sPhase += pow(sin(t * .1) * .5 + .5, 50.) * 5.;
    m += sparkle * sPhase;

    return m;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - iResolution.xy * 0.5) / iResolution.y;
    vec2 M = iMouse.xy / iResolution.xy - 0.5;

    float t = iTime * .1;

    float s = sin(t);
    float c = cos(t);
    mat2 rot = mat2(c, -s, s, c);
    vec2 st = uv * rot;
    M *= rot * 2.;

    float m = 0.;
    for (float i = 0.; i < 1.; i += 1. / NUM_LAYERS) {
        float z = fract(t + i);
        float size = mix(15., 1., z);
        float fade = S(0., .6, z) * S(1., .8, z);

        m += fade * NetLayer(st * size - M * z, i, iTime);
    }

    float fft = texelFetch(iChannel0, ivec2(.7, 0), 0).x;
    float glow = -uv.y * fft * 2.;

    vec3 baseCol = vec3(s, cos(t * .4), -sin(t * .24)) * .4 + .6;
    vec3 col = baseCol * m;
    col += baseCol * glow;

#ifdef SIMPLE
    uv *= 10.;
    col = vec3(1) * NetLayer(uv, 0., iTime);
    uv = fract(uv);
#else
    col *= 1. - dot(uv, uv);
    t = mod(iTime, 230.);
    col *= S(0., 20., t) * S(224., 200., t);
#endif

// Sample the terminal feed.
vec2 terminalUV = fragCoord / iResolution.xy;
vec4 terminalColor = texture(iChannel0, terminalUV);

// Define overlay opacity (controls how much the shader is dimmed)
float overlayOpacity = 0.9; // Adjust between 0.0 and 1.0 as needed

// Darken the shader animation by reducing its intensity.
vec3 darkShader = col * (1.0 - overlayOpacity);

// Use the existing mask from the terminal content.
float mask = 1.2 - step(0.5, dot(terminalColor.rgb, vec3(1.0)));

// Blend the terminal feed with the adjusted shader animation.
vec3 blendedColor = mix(terminalColor.rgb * 1.2, darkShader, mask);

fragColor = vec4(blendedColor, terminalColor.a);
}
