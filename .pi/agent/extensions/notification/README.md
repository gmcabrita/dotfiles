# Terminal notification

Replaces `sounds.ts`. Sends OSC 9 (`ESC ] 9 ; <response> BEL`)
when the main TUI session has finished all queued work, retries, and compaction.
Skips tmux subagents, forked sessions, and output redirected to a file or pipe.

Uses text from the last assistant message. Thinking and tool output are excluded.
Line breaks, tabs, and repeated spaces become one space. Terminal control codes
are removed. Markdown stays as text. Empty responses show `Pi is ready for input`.

The preview limit is 200 Unicode graphemes, including `…` when truncated, as in
[Codex CLI](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/notifications.rs).
The full payload, including any leading space, has a limit of 2047 UTF-8 bytes.
[Ghostty's OSC parser](https://github.com/ghostty-org/ghostty/blob/492300cad/src/terminal/osc.zig)
uses a 2048-byte buffer for OSC 9 text and needs one byte for a trailing NUL.
Truncation preserves complete graphemes, including emoji. Text that starts with
a digit gets a leading space. This prevents Ghostty from reading the response
as a ConEmu OSC 9 command.

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
   the response finishes. Check that it shows the response on one line.
   Click it and check that the original tab is selected.
3. Repeat with another app active. Click the notification and check that
   Ghostty and the original tab receive focus.

Native behavior was checked in the source for Ghostty `492300cad`:
[`shouldPresentNotification` and `handleUserNotification`](https://github.com/ghostty-org/ghostty/blob/492300cad/macos/Sources/Ghostty/Ghostty.App.swift),
and [`SurfaceView.handleUserNotification`](https://github.com/ghostty-org/ghostty/blob/492300cad/macos/Sources/Ghostty/Surface%20View/SurfaceView_AppKit.swift).
Unit tests check OSC output and session guards. They do not test macOS display
or clicks.
