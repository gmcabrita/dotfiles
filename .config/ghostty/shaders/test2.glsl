void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord.xy / iResolution.xy;
  vec4 color = texture(iChannel0, uv);
  
  vec2 step = vec2(1.414) / iResolution.xy;
  float radius = 100.0; // 100px bloom radius
  vec2 mouseUV = iMouse.xy / iResolution.xy;
  float distToMouse = length(fragCoord.xy - iMouse.xy);

  if (distToMouse < radius) {
    for (int i = 0; i < 24; i++) {
      vec3 s = samples[i];
      vec4 c = texture(iChannel0, uv + s.xy * step);
      float l = lum(c);
      if (l > 0.2) {
        color += l * s.z * c * 0.1;
      }
    }
  }

  fragColor = color;
}

