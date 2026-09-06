# Terminal notification

Replaces `sounds.ts`. Sends OSC 9 (`ESC ] 9 ; Pi is ready for input BEL`)
when the main TUI session has finished all queued work, retries, and compaction.
Skips tmux subagents, forked sessions, and output redirected to a file or pipe.

Ghostty handles notification display and clicks:

- The focused tab produces no banner or sound.
- An inactive tab can notify while another Ghostty tab is active.
- Clicking the notification selects the tab and terminal surface that sent it.

This uses Ghostty's native focus checks. The extension sends OSC 9 even when
the tab is focused; Ghostty suppresses its presentation. Other terminals can
handle OSC 9 differently. Terminal multiplexers can require OSC passthrough
configuration; selecting a tmux pane is outside this extension's scope.

## Setup

Copy this directory to `~/.pi/agent/extensions/notification/`. Remove the old
`~/.pi/agent/extensions/sounds.ts` so both extensions do not run. Then run
`/reload` in Pi.

Allow Ghostty notifications in macOS System Settings → Notifications → Ghostty. Ghostty requests permission on the first notification;
that first notification can be missed. Enable banners and sounds as required.
Ghostty's `desktop-notifications` setting must be `true` (the default).

## Checks

From `.pi/agent`:

```sh
npm run test:notification
npm run typecheck
```

Manual checks in a main Pi session, directly in Ghostty:

1. Keep the Pi tab focused until a response finishes. Expect no banner or sound.
2. Start a response and select another Ghostty tab. Expect a notification when
   the response finishes. Click it and check that the original tab is selected.
3. Repeat with another app active. Click the notification and check that
   Ghostty and the original tab receive focus.

Native behavior was checked in the source for Ghostty `492300cad`:
[`shouldPresentNotification` and `handleUserNotification`](https://github.com/ghostty-org/ghostty/blob/492300cad/macos/Sources/Ghostty/Ghostty.App.swift),
and [`SurfaceView.handleUserNotification`](https://github.com/ghostty-org/ghostty/blob/492300cad/macos/Sources/Ghostty/Surface%20View/SurfaceView_AppKit.swift).
Unit tests check OSC output and session guards. They do not test macOS display
or clicks.
