/**
 * /usage [provider] — show remaining quota or balance for every configured
 * provider that exposes a usage API.
 *
 * Subscription providers (anthropic, openai-codex, openai-codex-lb, opencode-go) render
 * percent bars per rate limit window. Pay-as-you-go providers (openrouter,
 * deepseek, abliteration) render dollar balances. Without an argument, subscription
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
  type UsageProvider,
  type UsageSeverity,
  type UsageStyle,
} from "./model.ts";
import { abliterationUsageProvider } from "./providers/abliteration.ts";
import { anthropicUsageProvider } from "./providers/anthropic.ts";
import { deepSeekUsageProvider } from "./providers/deepseek.ts";
import { openAICodexUsageProvider } from "./providers/openai-codex.ts";
import { openAICodexLbUsageProvider } from "./providers/openai-codex-lb.ts";
import { openCodeGoUsageProvider } from "./providers/opencode-go.ts";
import { openRouterUsageProvider } from "./providers/openrouter.ts";

const USAGE_PROVIDERS: UsageProvider[] = [
  anthropicUsageProvider,
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

/** Fetch every provider with stored auth in parallel. Errors stay per provider. */
async function collectUsage(ctx: ExtensionContext, providers: UsageProvider[]): Promise<ProviderResult[]> {
  const results = await Promise.all(
    providers.map(async (provider): Promise<ProviderResult | undefined> => {
      const auth = await resolveAuth(ctx, provider.id);
      if (!auth) return undefined;
      try {
        return { provider, status: "ok", usage: await provider.fetch(auth) };
      } catch (err) {
        return { provider, status: "error", message: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  return results.filter((result): result is ProviderResult => result !== undefined);
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
    return providers.filter((provider) => provider.billing === "prepaid" || scoped.has(provider.id));
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
    description: "Show remaining quota / balance per provider (anthropic, openai-codex, openai-codex-lb, opencode-go, openrouter, deepseek, abliteration)",
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
        rerender();
        const results = await collectUsage(ctx, providers);
        lines = results.length > 0
          ? formatUsageReport(results, new Date(), themeStyle(theme))
          : [theme.fg("dim", "No scoped provider with stored auth supports usage lookup.")];
        loading = false;
        if (!closed) rerender();
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
              const header = [theme.bold(" Usage"), ""];
              const body = (loading ? [theme.fg("dim", "Loading…")] : lines).map((line) => ` ${line}`);
              const maxRows = Math.floor((tui.terminal.rows * OVERLAY_MAX_HEIGHT_PERCENT) / 100);
              // Header, blank line before the footer, footer, and the two border rows.
              bodyHeight = Math.max(1, maxRows - header.length - 4);
              const viewport = scrollViewport(body, scrollOffset, bodyHeight);
              scrollOffset = viewport.offset;
              const position = viewport.maxOffset > 0
                ? ` · ↑↓/pgup/pgdn scroll ${viewport.offset + 1}–${viewport.offset + viewport.visible.length} of ${body.length}`
                : "";
              const footer = theme.fg("dim", ` r refresh · q/esc close${position}`);
              return frameLines([...header, ...viewport.visible, "", footer], width, theme);
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
