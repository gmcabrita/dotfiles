import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function isMainInteractiveSession(ctx: ExtensionContext) {
  // The tmux subagent runs in TUI mode and starts an unparented session, so
  // neither hasUI nor parentSession identifies it.
  if (process.env.PI_TMUX_SUBAGENT_CHILD === "1") return false;
  if (ctx.mode !== "tui" || !ctx.hasUI || !process.stdout.isTTY) return false;

  // Forked sessions must not send duplicate notifications.
  const header = ctx.sessionManager.getHeader();
  return !header?.parentSession;
}

/** Send OSC 9 notifications; Ghostty handles tab focus checks and notification clicks. */
export default function registerTerminalNotification(pi: ExtensionAPI) {
  // Wait until retries, compaction, and queued messages have finished.
  pi.on("agent_settled", (_event, ctx) => {
    if (!isMainInteractiveSession(ctx)) return;
    if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

    // Ghostty suppresses banners for the focused surface and selects the
    // originating tab when clicked, including when another tab is active.
    process.stdout.write("\x1b]9;Pi is ready for input\x07");
  });
}
