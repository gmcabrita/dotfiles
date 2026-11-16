---
name: browser-recording
description: Record browser videos with browse at 1920×1080, 60 fps, with supersampling. Use when asked to record a browser flow, capture a screen recording or demo video of a web page, or make a PR demo video.
---

# Browser recording

Record at 1920×1080 with supersampling. Run `browse recording --help`, `browse emulate --help` and `browse execute --help` for the tool options.

## Constraints

- An `.mp4` or `.webm` recording is captured at CSS viewport size, so `deviceScaleFactor` has no effect on it. Record to `.mkv`: it keeps device pixels (3840×2160 at `deviceScaleFactor: 2`). Then scale it down to 1920×1080 with `ffmpeg`.
- browse keeps the `emulate` viewport on the tab across navigations and `execute` calls. Reset it when the recording is done.
- Output files must be inside the browse file roots (`files.roots`: `/tmp` and `$TMPDIR` by default), in a private folder. Make the folder with `mktemp -d`.
- The screencast sends frames only when the page paints. The `.mkv` has a variable frame rate. The `fps=60` filter makes it constant.

## Steps

1. Open a tab: `browse navigate <url>`. Keep the `tab` id from the output. Do a dry run of the flow first.
2. Make a private folder: `D=$(mktemp -d /tmp/browse-recording.XXXXXX)`.
3. Write `$D/record.js`. Replace `<D>` with the folder path:

   ```js
   const video = "<D>/raw.mkv";
   await browse.emulate({ viewport: { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false } });
   await page.goto("https://example.com");
   const viewport = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
   if (viewport.join() !== "1920,1080,2") throw new Error(`Bad viewport ${viewport}`);

   await browse.recording({ action: "start", path: video, frameRate: 60 });
   try {
     await page.mouse.move(5, 5); // The first frames are blank until the page paints again.

     // The recorded flow. Add very short pauses after each important state, so viewers can read the screen.

     return await browse.recording({ action: "stop" });
   } catch (error) {
     await browse.recording({ action: "cancel" });
     throw error;
   }
   ```

4. Run the script, then scale the video:

   ```sh
   browse execute --tab <tab> --file "$D/record.js" --timeoutMs 240000
   ffmpeg -v error -y -i "$D/raw.mkv" \
     -vf "fps=60,scale=1920:1080:flags=lanczos" \
     -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -movflags +faststart \
     "$PWD/<file>.mp4"
   ```

   If the script fails, read the error, fix the script and run it again.

5. Before sharing, check the file with `ffprobe` (1920×1080, 60 fps). Look at frames sampled across the full video, including the first and last frames.
6. Reset the viewport and close the tab: `browse emulate <tab> --viewport reset`, then `browse tabs close --tab <tab>`.
7. Put PR demo videos in the PR description.
