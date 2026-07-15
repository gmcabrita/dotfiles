import type {
  ExtensionAPI,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

function blockStatuses(ui: ExtensionUIContext) {
  ui.setStatus = () => {};
}

export default function disableStatuses(pi: ExtensionAPI) {
  const patchedContexts = new WeakSet<ExtensionUIContext>();

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI || patchedContexts.has(ctx.ui)) return;
    blockStatuses(ctx.ui);
    patchedContexts.add(ctx.ui);
  });
}
