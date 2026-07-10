import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

const DEFAULT_CAP = 200_000;

type OriginalLimits = {
  contextWindow: number;
  maxTokens: number;
};

type RegistryOriginals = Map<string, OriginalLimits>;

const patchedRegistries = new WeakSet<ExtensionContext["modelRegistry"]>();
const registryOriginals = new WeakMap<ExtensionContext["modelRegistry"], RegistryOriginals>();

function modelKey(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

function capModel(model: Model<Api>, cap: number): boolean {
  let changed = false;

  if (model.contextWindow > cap) {
    model.contextWindow = cap;
    changed = true;
  }

  if (model.maxTokens > cap) {
    model.maxTokens = cap;
    changed = true;
  }

  return changed;
}

function getOriginals(ctx: ExtensionContext): RegistryOriginals {
  const existing = registryOriginals.get(ctx.modelRegistry);
  if (existing) return existing;

  const originals = new Map<string, OriginalLimits>();
  registryOriginals.set(ctx.modelRegistry, originals);
  return originals;
}

function applyCap(ctx: ExtensionContext, cap: number): number {
  const originals = getOriginals(ctx);
  let changed = 0;

  for (const model of ctx.modelRegistry.getAll()) {
    const key = modelKey(model);

    if (!originals.has(key)) {
      originals.set(key, {
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      });
    }

    if (capModel(model, cap)) {
      changed += 1;
    }
  }

  if (ctx.model) {
    capModel(ctx.model, cap);
  }

  return changed;
}

function restoreModel(
  model: Model<Api> | undefined,
  originals: RegistryOriginals | undefined,
): void {
  if (!model || !originals) return;

  const original = originals.get(modelKey(model));
  if (!original) return;

  model.contextWindow = original.contextWindow;
  model.maxTokens = original.maxTokens;
}

function removeCap(ctx: ExtensionContext): void {
  const originals = registryOriginals.get(ctx.modelRegistry);

  for (const model of ctx.modelRegistry.getAll()) {
    restoreModel(model, originals);
  }

  restoreModel(ctx.model, originals);
  ctx.modelRegistry.refresh();
  registryOriginals.delete(ctx.modelRegistry);
}

function patchRegistryRefresh(
  ctx: ExtensionContext,
  shouldCap: () => boolean,
  getCap: () => number,
): void {
  if (patchedRegistries.has(ctx.modelRegistry)) return;

  const refresh = ctx.modelRegistry.refresh.bind(ctx.modelRegistry);
  ctx.modelRegistry.refresh = () => {
    refresh();
    if (shouldCap()) {
      applyCap(ctx, getCap());
    }
  };

  patchedRegistries.add(ctx.modelRegistry);
}

export default function contextWindowCapExtension(pi: ExtensionAPI) {
  let enabled = true;
  let cap = DEFAULT_CAP;

  function install(ctx: ExtensionContext): number {
    patchRegistryRefresh(
      ctx,
      () => enabled,
      () => cap,
    );
    return enabled ? applyCap(ctx, cap) : 0;
  }

  pi.on("session_start", async (_event, ctx) => {
    install(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    install(ctx);
  });

  pi.registerCommand("context-window-cap", {
    description:
      "Show/set/toggle model context cap. Usage: /context-window-cap [status|on|off|150000]",
    handler: async (args, ctx) => {
      const arg = args.trim();

      if (arg === "" || arg === "status") {
        const state = enabled ? `on (${cap})` : "off";
        ctx.ui.notify(`context window cap: ${state}`, "info");
        return;
      }

      if (arg === "off" || arg === "disable") {
        enabled = false;
        removeCap(ctx);

        if (ctx.model) {
          const refreshedModel = ctx.modelRegistry.find(ctx.model.provider, ctx.model.id);
          if (refreshedModel) {
            await pi.setModel(refreshedModel);
          }
        }

        ctx.ui.notify("context window cap: off", "info");
        return;
      }

      if (arg === "on" || arg === "enable") {
        enabled = true;
        const changed = install(ctx);
        ctx.ui.notify(`context window cap: on (${cap}), capped ${changed} models`, "info");
        return;
      }

      const nextCap = Number(arg.replaceAll("_", ""));
      if (!Number.isInteger(nextCap) || nextCap <= 0) {
        ctx.ui.notify("usage: /context-window-cap [status|on|off|150000]", "error");
        return;
      }

      cap = nextCap;
      enabled = true;
      removeCap(ctx);
      const changed = install(ctx);
      ctx.ui.notify(`context window cap: on (${cap}), capped ${changed} models`, "info");
    },
  });
}
