// Shows border on focused pane
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;

  // Sample the terminal content
  vec4 terminal = texture2D(iChannel0, uv);
  vec3 color = terminal.rgb;

  if (iFocus > 0) {
    // FOCUSED: Add border
    float borderSize = 2.0;
    vec2 pixelCoord = fragCoord;
    bool isBorder = pixelCoord.x < borderSize ||
      pixelCoord.x > iResolution.x - borderSize ||
      pixelCoord.y < borderSize ||
      pixelCoord.y > iResolution.y - borderSize;

    if (isBorder) {
      // macOS-selection-blue border
      color = vec3(0, 0.35, 0.74) * 1.0;
    }
  }
  fragColor = vec4(color, 1.0);
}
