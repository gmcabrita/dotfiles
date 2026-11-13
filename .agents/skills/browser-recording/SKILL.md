---
name: browser-recording
description: Record browser videos with browse at 1920×1080, 60 fps, with supersampling. Use when asked to record a browser flow, capture a screen recording or demo video of a web page, or make a PR demo video.
---

# Browser recording

Use together with the `browse` skill. Record at 1920×1080 with supersampling.

## Steps

1. Use a tab that browse owns and `--mode cdp`. Do not use tab capture: it runs at 30 fps and compresses more.
2. Do a dry run of the flow first.
3. Set the viewport through CDP after the last navigation, just before recording. A navigation or a debugger reattach removes the override, so check it again before you start.

   ```js
   const cdp = await page.context().newCDPSession(page);
   await cdp.send("Emulation.setDeviceMetricsOverride", {
     width: 1920,
     height: 1080,
     deviceScaleFactor: 2,
     mobile: false,
   });
   return await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })); // expect 1920, 1080, 2
   ```

   Do not use `page.setViewportSize`: it sets `devicePixelRatio` to 1.

4. Start: `browse recording start <file>.mp4 --session <s> --mode cdp --frame-rate 60 --cursor`.
5. Run the recorded flow as one script with `--timeout-ms 240000`.
   - Begin the script with a small mouse move, so the first frames are not blank.
   - Add very short pauses after each important state, so viewers can read the screen.
6. Before sharing, check the file with `ffprobe` (1920×1080, 60 fps). Look at frames sampled across the full video, including the last frame.
7. Put PR demo videos in the PR description.
