import type {
  ExtensionAPI,
  ExtensionContext,
  BeforeProviderRequestEvent,
} from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_provider_request", (event: BeforeProviderRequestEvent, ctx: ExtensionContext) => {
    const model = ctx.model;
    if (!model || !model.provider.includes("openai") || !model.api.includes("-responses")) return;
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return;

    return {
      ...(event.payload as Record<string, unknown>),
      service_tier: "priority",
    };
  });
}
