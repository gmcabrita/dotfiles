import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const SPINNER_FRAMES = ["▁", "▃", "▅", "▇", "▅", "▃"] as const;
const FRAME_INTERVAL_MS = 120;

function baseTitle(pi: ExtensionAPI, ctx: ExtensionContext): string {
  const project = basename(ctx.cwd);
  const session = pi.getSessionName();
  return session ? `π · ${session} · ${project}` : `π · ${project}`;
}

export default function titlebarSpinnerExtension(pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let frameIndex = 0;

  function setIdleTitle(ctx: ExtensionContext): void {
    ctx.ui.setTitle(baseTitle(pi, ctx));
  }

  function stop(ctx: ExtensionContext): void {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    frameIndex = 0;
    setIdleTitle(ctx);
  }

  function start(ctx: ExtensionContext): void {
    stop(ctx);

    const renderFrame = () => {
      const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
      ctx.ui.setTitle(`${frame} ${baseTitle(pi, ctx)}`);
      frameIndex += 1;
    };

    renderFrame();
    timer = setInterval(renderFrame, FRAME_INTERVAL_MS);
    timer.unref();
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") stop(ctx);
  });

  pi.on("session_info_changed", (_event, ctx) => {
    if (ctx.mode === "tui" && timer === undefined) setIdleTitle(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode === "tui") start(ctx);
  });

  // agent_end can be followed by retries, compaction, or queued messages.
  pi.on("agent_settled", (_event, ctx) => {
    if (ctx.mode === "tui" && ctx.isIdle()) stop(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") stop(ctx);
  });
}
