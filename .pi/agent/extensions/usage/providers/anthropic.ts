/**
 * Anthropic (Claude Pro/Max) usage via the OAuth endpoint Claude Code's
 * /usage screen reads. Requires OAuth credentials; API keys are rejected.
 */

import { limitRow, parseDate, type ProviderUsage, type UsageProvider, type UsageSeverity } from "../model.ts";
import { getJson } from "./http.ts";

export const ANTHROPIC_USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";

interface AnthropicLimit {
  kind: string;
  percent: number;
  severity: string;
  resets_at: string | null;
  scope: { model?: { display_name?: string | null } | null } | null;
}

interface AnthropicWindow {
  utilization: number;
  resets_at: string | null;
}

export interface AnthropicUsageResponse {
  limits?: AnthropicLimit[] | null;
  five_hour?: AnthropicWindow | null;
  seven_day?: AnthropicWindow | null;
  extra_usage?: { is_enabled: boolean; utilization: number | null } | null;
  seven_day_breakdown?: { rows: { display_name: string; percent: number }[] } | null;
}

function toSeverity(raw: string): UsageSeverity {
  if (raw === "normal") return "normal";
  if (raw === "warning") return "warning";
  return "critical";
}

function limitLabel(limit: AnthropicLimit): string {
  const model = limit.scope?.model?.display_name;
  switch (limit.kind) {
    case "session":
      return "Session (5h)";
    case "weekly_all":
      return "Weekly (all models)";
    case "weekly_scoped":
      return model ? `Weekly (${model})` : "Weekly (scoped)";
    default:
      return model ? `${limit.kind} (${model})` : limit.kind;
  }
}

export function parseAnthropicUsage(body: AnthropicUsageResponse): ProviderUsage {
  const rows: ProviderUsage["rows"] = [];

  if (Array.isArray(body.limits) && body.limits.length > 0) {
    for (const limit of body.limits) {
      rows.push(limitRow(limitLabel(limit), limit.percent, parseDate(limit.resets_at), toSeverity(limit.severity)));
    }
  } else {
    if (body.five_hour) rows.push(limitRow("Session (5h)", body.five_hour.utilization, parseDate(body.five_hour.resets_at)));
    if (body.seven_day) rows.push(limitRow("Weekly (all models)", body.seven_day.utilization, parseDate(body.seven_day.resets_at)));
  }

  const notes: string[] = [];
  const extra = body.extra_usage;
  if (extra?.is_enabled) {
    notes.push(`Extra usage: enabled${extra.utilization === null ? "" : ` (${Math.round(extra.utilization)}% used)`}`);
  }
  const breakdown = body.seven_day_breakdown?.rows ?? [];
  if (breakdown.length > 0) {
    notes.push(`Weekly breakdown: ${breakdown.map((row) => `${row.display_name} ${row.percent}%`).join(" · ")}`);
  }

  return { rows, notes };
}

export const anthropicUsageProvider: UsageProvider = {
  id: "anthropic",
  label: "Anthropic (Claude)",
  async fetch(auth) {
    if (auth.source !== "OAuth") {
      throw new Error("OAuth login required: run `pi auth login anthropic`.");
    }
    const body = await getJson<AnthropicUsageResponse>(ANTHROPIC_USAGE_ENDPOINT, {
      Authorization: `Bearer ${auth.token}`,
      "anthropic-beta": "oauth-2025-04-20",
    });
    return parseAnthropicUsage(body);
  },
};
