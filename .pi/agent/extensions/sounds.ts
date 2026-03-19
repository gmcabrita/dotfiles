import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

function play(sound: string) {
  const child = spawn("afplay", [sound], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function isMainInteractiveSession(ctx: ExtensionContext) {
  // Skip print/json runs and most subagent/background runs
  if (!ctx.hasUI) return false;

  // Optional: also skip forked sessions
  const header = ctx.sessionManager.getHeader?.();
  return !header?.parentSession;
}

export default function (pi: ExtensionAPI) {
  const dangerousPatterns = [
    /\brm\s+(-rf?|--recursive)\b/i,
    /\bsudo\b/i,
    /\b(chmod|chown)\b.*777/i,
  ];

  // Closest to OpenCode's "session.idle"
  pi.on("agent_end", async (_event, ctx) => {
    if (!isMainInteractiveSession(ctx)) return;
    if (ctx.hasPendingMessages()) return;

    play("/System/Library/Sounds/Submarine.aiff");
  });

  // Pi has no global permission.updated event.
  // So implement the gate here and play the sound before prompting.
  pi.on("tool_call", async (event, ctx) => {
    if (!isMainInteractiveSession(ctx)) return;
    if (!ctx.hasUI) return;

    if (!isToolCallEventType("bash", event)) return;

    const command = event.input.command;
    const isDangerous = dangerousPatterns.some((p) => p.test(command));
    if (!isDangerous) return;

    play("/System/Library/Sounds/Ping.aiff");

    const ok = await ctx.ui.confirm("Allow dangerous command?", command);

    if (!ok) {
      return { block: true, reason: "Blocked by user" };
    }
  });
}
