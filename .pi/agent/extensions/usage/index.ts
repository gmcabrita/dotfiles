/**
 * /usage [provider] — show remaining quota or balance for every configured
 * provider that exposes a usage API.
 *
 * Subscription providers (anthropic, openai-codex, openai-codex-lb, opencode-go) render
 * percent bars per rate limit window. Pay-as-you-go providers (anthropic-console,
 * openrouter, deepseek, abliteration) render dollar balances. anthropic-console
 * reads Claude Console credits through the logged-in browser via `browse`. Without an argument, subscription
 * providers are limited to the session's scoped models (`enabledModels` / `--models`)
 * while prepaid providers are always queried; `/usage <provider>` queries that provider
 * regardless of scope. Providers
 * without stored auth are skipped; opencode (Zen) has no usage API and is not listed.
 */

import type { Component } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  formatUsageReport,
  type ProviderAuth,
  type ProviderResult,
  type ProviderUsage,
  type UsageProvider,
  type UsageSeverity,
  type UsageStyle,
} from "./model.ts";
import { abliterationUsageProvider } from "./providers/abliteration.ts";
import { anthropicUsageProvider } from "./providers/anthropic.ts";
import { anthropicConsoleUsageProvider } from "./providers/anthropic-console.ts";
import { deepSeekUsageProvider } from "./providers/deepseek.ts";
import { openAICodexUsageProvider } from "./providers/openai-codex.ts";
import { openAICodexLbUsageProvider } from "./providers/openai-codex-lb.ts";
import { openCodeGoUsageProvider } from "./providers/opencode-go.ts";
import { openRouterUsageProvider } from "./providers/openrouter.ts";

const USAGE_PROVIDERS: UsageProvider[] = [
  anthropicUsageProvider,
  anthropicConsoleUsageProvider,
  openAICodexUsageProvider,
  openAICodexLbUsageProvider,
  openCodeGoUsageProvider,
  openRouterUsageProvider,
  deepSeekUsageProvider,
  abliterationUsageProvider,
];

const OVERLAY_MAX_HEIGHT_PERCENT = 80;

async function resolveAuth(ctx: ExtensionContext, providerId: string): Promise<ProviderAuth | undefined> {
  const result = await ctx.modelRegistry.getProviderAuth(providerId);
  const token = result?.auth.apiKey;
  return token ? { token, source: result?.source } : undefined;
}

/** Usage endpoints rate-limit repeated /usage calls (Anthropic's OAuth endpoint does); errors are not cached. */
const USAGE_CACHE_TTL_MS = 5 * 60_000;
const usageCache = new Map<string, { usage: ProviderUsage; fetchedAt: number }>();

async function fetchUncachedUsage(ctx: ExtensionContext, provider: UsageProvider): Promise<ProviderUsage | undefined> {
  if ("browserSession" in provider) return provider.fetch();
  const auth = await resolveAuth(ctx, provider.id);
  return auth ? provider.fetch(auth) : undefined;
}

async function fetchUsage(ctx: ExtensionContext, provider: UsageProvider): Promise<ProviderUsage | undefined> {
  const cached = usageCache.get(provider.id);
  if (cached && Date.now() - cached.fetchedAt < USAGE_CACHE_TTL_MS) return cached.usage;
  const usage = await fetchUncachedUsage(ctx, provider);
  if (usage) usageCache.set(provider.id, { usage, fetchedAt: Date.now() });
  return usage;
}

async function fetchResult(ctx: ExtensionContext, provider: UsageProvider): Promise<ProviderResult | undefined> {
  try {
    const usage = await fetchUsage(ctx, provider);
    return usage ? { provider, status: "ok", usage } : undefined;
  } catch (err) {
    return { provider, status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fetch every provider with stored auth or a browser session in parallel. Errors stay per provider.
 * `onProgress` receives the results in provider order after each fetch, with unfinished ones as "loading".
 */
async function collectUsage(
  ctx: ExtensionContext,
  providers: UsageProvider[],
  onProgress?: (results: ProviderResult[]) => void,
): Promise<ProviderResult[]> {
  const slots: (ProviderResult | undefined)[] = providers.map((provider) => ({ provider, status: "loading" }));
  const snapshot = () => slots.filter((result): result is ProviderResult => result !== undefined);
  onProgress?.(snapshot());
  await Promise.all(
    providers.map(async (provider, index) => {
      slots[index] = await fetchResult(ctx, provider);
      onProgress?.(snapshot());
    }),
  );
  return snapshot();
}

/** Provider ids of the session's scoped models; empty means no scoping configured. */
export function scopedProviderIds(scopedModels: readonly { model: { provider: string } }[]): Set<string> {
  return new Set(scopedModels.map((scoped) => scoped.model.provider));
}

export function selectProviders(
  providers: UsageProvider[],
  args: string,
  scoped: Set<string>,
): UsageProvider[] | undefined {
  const wanted = args.trim().toLowerCase();
  if (wanted === "") {
    if (scoped.size === 0) return providers;
    return providers.filter(
      (provider) =>
        provider.billing === "prepaid" ||
        scoped.has(provider.id) ||
        (provider.scopedVia ?? []).some((id) => scoped.has(id)),
    );
  }
  const matches = providers.filter((provider) => provider.id === wanted);
  return matches.length > 0 ? matches : undefined;
}

/**
 * Wrap lines in a box and pad each to the full width. Overlays draw on top
 * of the chat, so unpadded lines let the text behind show through.
 */
function frameLines(lines: string[], width: number, theme: Theme): string[] {
  const innerWidth = Math.max(1, width - 2);
  const border = (text: string) => theme.fg("borderMuted", text);
  const framed = lines.map((line) => {
    const truncated = truncateToWidth(line, innerWidth, "…");
    return border("│") + truncated + " ".repeat(Math.max(0, innerWidth - visibleWidth(truncated))) + border("│");
  });
  return [border(`┌${"─".repeat(innerWidth)}┐`), ...framed, border(`└${"─".repeat(innerWidth)}┘`)];
}

export interface Viewport {
  visible: string[];
  /** Offset clamped to the scrollable range. */
  offset: number;
  maxOffset: number;
}

export function scrollViewport(lines: string[], offset: number, height: number): Viewport {
  const rows = Math.max(1, height);
  const maxOffset = Math.max(0, lines.length - rows);
  const clamped = Math.min(maxOffset, Math.max(0, offset));
  return { visible: lines.slice(clamped, clamped + rows), offset: clamped, maxOffset };
}

function themeStyle(theme: Theme): UsageStyle {
  const color = (severity: UsageSeverity) =>
    severity === "normal" ? "success" : severity === "warning" ? "warning" : "error";
  return {
    bold: (text) => theme.bold(text),
    dim: (text) => theme.fg("dim", text),
    severity: (severity, text) => theme.fg(color(severity), text),
  };
}

export default function usageExtension(pi: ExtensionAPI) {
  pi.registerCommand("usage", {
    description: "Show remaining quota / balance per provider (anthropic, anthropic-console, openai-codex, openai-codex-lb, opencode-go, openrouter, deepseek, abliteration)",
    getArgumentCompletions: (prefix) => {
      const matches = USAGE_PROVIDERS.filter((provider) => provider.id.startsWith(prefix.toLowerCase()));
      return matches.length > 0 ? matches.map((provider) => ({ value: provider.id, label: provider.label })) : null;
    },
    handler: async (args, ctx) => {
      const providers = selectProviders(USAGE_PROVIDERS, args, scopedProviderIds(ctx.scopedModels));
      if (!providers) {
        const known = USAGE_PROVIDERS.map((provider) => provider.id).join(", ");
        ctx.ui.notify(`Unknown provider. Known: ${known}`, "warning");
        return;
      }

      if (!ctx.hasUI) {
        const results = await collectUsage(ctx, providers);
        console.log(formatUsageReport(results, new Date()).join("\n"));
        return;
      }

      let lines: string[] = [];
      let loading = true;
      let scrollOffset = 0;
      let bodyHeight = 1;
      // Set when the overlay closes so an in-flight refresh does not touch the TUI.
      let closed = false;

      const load = async (rerender: () => void, theme: Theme) => {
        loading = true;
        const show = (results: ProviderResult[]) => {
          lines = results.length > 0 || loading
            ? formatUsageReport(results, new Date(), themeStyle(theme))
            : [theme.fg("dim", "No scoped provider with stored auth supports usage lookup.")];
          if (!closed) rerender();
        };
        const results = await collectUsage(ctx, providers, show);
        loading = false;
        show(results);
      };

      await ctx.ui.custom<void>(
        (tui, theme, keybindings, done) => {
          const rerender = () => tui.requestRender();
          void load(rerender, theme);

          const scrollBy = (delta: number) => {
            scrollOffset += delta;
            rerender();
          };

          const component: Component = {
            invalidate: () => {},
            render: (width) => {
              const body = lines.map((line) => ` ${line}`);
              const maxRows = Math.floor((tui.terminal.rows * OVERLAY_MAX_HEIGHT_PERCENT) / 100);
              // Blank line before the footer, footer, and the two border rows.
              bodyHeight = Math.max(1, maxRows - 4);
              const viewport = scrollViewport(body, scrollOffset, bodyHeight);
              scrollOffset = viewport.offset;
              const position = viewport.maxOffset > 0
                ? ` · ↑↓/pgup/pgdn scroll ${viewport.offset + 1}–${viewport.offset + viewport.visible.length} of ${body.length}`
                : "";
              const footer = theme.fg("dim", ` r refresh · q/esc close${position}`);
              return frameLines([...viewport.visible, "", footer], width, theme);
            },
            handleInput: (data) => {
              if (keybindings.matches(data, "tui.select.cancel") || data.toLowerCase() === "q") {
                closed = true;
                done();
                return;
              }
              if (keybindings.matches(data, "tui.select.up") || data === "k") return scrollBy(-1);
              if (keybindings.matches(data, "tui.select.down") || data === "j") return scrollBy(1);
              if (keybindings.matches(data, "tui.select.pageUp")) return scrollBy(-bodyHeight);
              if (keybindings.matches(data, "tui.select.pageDown")) return scrollBy(bodyHeight);
              if (data.toLowerCase() === "r" && !loading) {
                void load(rerender, theme);
              }
            },
          };
          return component;
        },
        {
          overlay: true,
          overlayOptions: { width: "80%", maxHeight: `${OVERLAY_MAX_HEIGHT_PERCENT}%`, anchor: "center" },
        },
      );
    },
  });
}
