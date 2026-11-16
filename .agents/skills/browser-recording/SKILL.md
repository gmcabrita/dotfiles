---
name: browser-recording
description: Record browser videos with browse at 1920×1080, 60 fps, with supersampling. Use when asked to record a browser flow, capture a screen recording or demo video of a web page, or make a PR demo video.
---

# Browser recording

Record at 1920×1080 with supersampling. Run `browse --help` for the browse agent guide.

## Constraints

- browse clears a viewport override when the script that set it ends. A recording must start and stop while the script that set the viewport still runs.
- `browse recording start` reads the viewport size once, at start. If the viewport changes during the recording, the output is cropped or padded.
- Scripts cannot start or stop a recording. Run the script in the background, and sync the script and the shell through marker files in `/tmp`. Scripts can read and write files in `/tmp` with `files.read` and `files.write`.

## Steps

1. Create a session: `browse session new`. Do a dry run of the flow first.
2. Write the script. Set the viewport after the last navigation that comes before the recording. Do not use `page.setViewportSize`: it sets `devicePixelRatio` to 1.

   ```js
   const sync = "/tmp/browse-recording";
   async function waitFor(name, timeoutMs = 60_000) {
     const end = Date.now() + timeoutMs;
     for (;;) {
       try { await files.read(`${sync}/${name}`, "utf8"); return; } catch {}
       if (Date.now() > end) throw new Error(`Timed out waiting for ${name}`);
       await page.waitForTimeout(100);
     }
   }

   await page.goto("https://example.com");
   const cdp = await page.context().newCDPSession(page);
   await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false });
   const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
   if (viewport.w !== 1920 || viewport.h !== 1080 || viewport.dpr !== 2) throw new Error(`Bad viewport ${JSON.stringify(viewport)}`);

   await files.write(`${sync}/ready`, "1");
   await waitFor("recording");
   await page.mouse.move(5, 5); // The first frames are blank until the page paints again.

   // The recorded flow. Add very short pauses after each important state, so viewers can read the screen.

   await files.write(`${sync}/done`, "1");
   await waitFor("stopped");
   ```

3. Run the script and the recording:

   ```sh
   S=<session>; D=/tmp/browse-recording
   rm -rf "$D"; mkdir -p "$D"
   browse execute -s "$S" --file record.js --timeout-ms 240000 > "$D/execute.log" 2>&1 &
   pid=$!
   # Stop waiting if the script exits early.
   until [ -e "$D/ready" ] || ! kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
   browse recording start "$PWD/<file>.mp4" -s "$S" --frame-rate 60
   touch "$D/recording"
   until [ -e "$D/done" ] || ! kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
   browse recording stop -s "$S"
   touch "$D/stopped"
   wait "$pid"; cat "$D/execute.log"
   ```

   If the script fails before `done`, delete the video and fix the script. Read `execute.log` for the error.

4. Before sharing, check the file with `ffprobe` (1920×1080, 60 fps). Look at frames sampled across the full video, including the first and last frames.
5. Delete the session: `browse session delete <session>`.
6. Put PR demo videos in the PR description.
