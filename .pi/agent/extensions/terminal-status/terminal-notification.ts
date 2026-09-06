import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatNotificationText } from "./notification-text.ts";

// Ghostty 492300cad applies title changes after 75 ms. Allow that timer to run.
const NOTIFICATION_DELAY_MS = 100;

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
  let response = "";
  let notificationTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelNotification() {
    if (notificationTimer !== undefined) clearTimeout(notificationTimer);
    notificationTimer = undefined;
  }

  function resetNotification() {
    cancelNotification();
    response = "";
  }

  pi.on("session_start", resetNotification);
  pi.on("agent_start", resetNotification);
  pi.on("session_shutdown", resetNotification);
  pi.on("agent_end", (event) => {
    response = "";
    for (let index = event.messages.length - 1; index >= 0; index--) {
      const message = event.messages[index];
      if (message.role !== "assistant") continue;
      response = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      break;
    }
  });

  // Wait until retries, compaction, and queued messages have finished.
  pi.on("agent_settled", (_event, ctx) => {
    cancelNotification();
    if (!isMainInteractiveSession(ctx)) return;
    if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

    const text = formatNotificationText(response);
    notificationTimer = setTimeout(() => {
      notificationTimer = undefined;
      if (!isMainInteractiveSession(ctx)) return;
      if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

      // Ghostty suppresses banners for the focused surface and selects the
      // originating tab when clicked, including when another tab is active.
      process.stdout.write(`\x1b]9;${text}\x07`);
    }, NOTIFICATION_DELAY_MS);
    notificationTimer.unref();
  });
}
