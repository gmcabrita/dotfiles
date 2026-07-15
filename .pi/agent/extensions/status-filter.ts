import type {
  ExtensionAPI,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

const BLOCKED_STATUS_KEYS = new Set(["mcp"]);

function blockStatuses(ui: ExtensionUIContext) {
  const setStatus = ui.setStatus.bind(ui);

  for (const key of BLOCKED_STATUS_KEYS) setStatus(key, undefined);

  ui.setStatus = (key, text) => {
    if (BLOCKED_STATUS_KEYS.has(key)) return;
    setStatus(key, text);
  };
}

export default function statusFilter(pi: ExtensionAPI) {
  const patchedContexts = new WeakSet<ExtensionUIContext>();

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI || patchedContexts.has(ctx.ui)) return;
    blockStatuses(ctx.ui);
    patchedContexts.add(ctx.ui);
  });
}
