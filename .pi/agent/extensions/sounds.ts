import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function play(sound: string) {
  const child = spawn("afplay", [sound], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function isMainInteractiveSession(ctx: ExtensionContext) {
  // The tmux subagent runs in TUI mode and starts an unparented session, so
  // neither hasUI nor parentSession identifies it.
  if (process.env.PI_TMUX_SUBAGENT_CHILD === "1") return false;
  if (!ctx.hasUI) return false;

  // Optional: also skip forked sessions
  const header = ctx.sessionManager.getHeader?.();
  return !header?.parentSession;
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async (_event, ctx) => {
    if (!isMainInteractiveSession(ctx)) return;
    if (ctx.hasPendingMessages()) return;

    play("/System/Library/Sounds/Submarine.aiff");
  });
}
