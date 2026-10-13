# Terminal status

Shows a spinner in the terminal title while Pi works. The title is
`π · <session> · <project>`, or `π · <project>` for an unnamed session. The spinner stops when Pi has finished all queued
work, retries, and compaction.

Rex sends the notification when Pi finishes. Rex reads the Pi screen to find
when Pi works. Enable "notify when done" for agents in the Rex settings.

## Setup

Copy this directory to `~/.pi/agent/extensions/terminal-status/`. Then run
`/reload` in Pi.

## Checks

From `.pi/agent`:

```sh
npm run test:terminal-status
npm run typecheck
```
