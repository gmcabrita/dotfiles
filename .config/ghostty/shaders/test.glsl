void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 mouse = iMouse.xy / iResolution.xy;
    
    // Fetch the previous frame
    vec4 prevColor = texture(iChannel0, uv);
    
    // Compute a smear effect based on mouse movement
    vec2 diff = mouse - (iMouse.zw / iResolution.xy);
    float strength = smoothstep(0.0, 0.1, length(diff)); // Increase smear intensity
    
    // Blend the new smear color
    vec3 newColor = mix(prevColor.rgb, vec3(1.0, 0.0, 0.0), strength); // Change to red
    
    fragColor = vec4(newColor, 1.0);
}
