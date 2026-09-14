/**
 * codex-lb (https://github.com/soju06/codex-lb) usage via its API-key
 * authenticated `GET /v1/usage` route. The origin is derived from the same
 * base URL the openai-codex-lb provider extension uses.
 */

import { BASE_URL_ENV, DEFAULT_BASE_URL } from "../../openai-codex-lb/index.ts";
import { limitRow, parseDate, type ProviderUsage, type UsageProvider } from "../model.ts";
import { getJson } from "./http.ts";

interface CodexLbLimit {
  limit_type: string;
  limit_window: string;
  max_value: number;
  current_value: number;
  remaining_value: number;
  model_filter: string | null;
  reset_at: string;
  source: string;
}

export interface CodexLbUsageResponse {
  request_count: number;
  total_tokens: number;
  cached_input_tokens?: number;
  total_cost_usd: number;
  limits: CodexLbLimit[];
  upstream_limits?: CodexLbLimit[];
  /** Remaining percent of the account pool per window; null when hidden. */
  account_pool_usage?: { primary: number | null; secondary: number | null } | null;
}

export function resolveCodexLbUsageUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${new URL(env[BASE_URL_ENV] ?? DEFAULT_BASE_URL).origin}/v1/usage`;
}

/**
 * `source: "aggregate"` rows describe the shared ChatGPT account pool;
 * anything else is a limit set on this API key in the codex-lb dashboard.
 */
function limitLabel(limit: CodexLbLimit): string {
  if (limit.source === "aggregate") return `Pool (${limit.limit_window})`;
  const scope = limit.model_filter ? ` ${limit.model_filter}` : "";
  return `Key ${limit.limit_window} ${limit.limit_type}${scope}`;
}

export function parseCodexLbUsage(body: CodexLbUsageResponse): ProviderUsage {
  const rows: ProviderUsage["rows"] = [];
  const limits = body.limits ?? [];

  for (const limit of limits) {
    const percent = limit.max_value > 0 ? (limit.current_value / limit.max_value) * 100 : 0;
    rows.push(limitRow(limitLabel(limit), percent, parseDate(limit.reset_at)));
  }

  // account_pool_usage repeats the aggregate limits without reset times, so
  // only add pool rows for windows the limits above do not already cover.
  const coveredWindows = new Set(limits.filter((limit) => limit.source === "aggregate").map((limit) => limit.limit_window));
  const pool = body.account_pool_usage;
  if (pool?.primary !== null && pool?.primary !== undefined && !coveredWindows.has("5h")) {
    rows.push(limitRow("Pool (5h)", 100 - pool.primary, null));
  }
  if (pool?.secondary !== null && pool?.secondary !== undefined && !coveredWindows.has("7d")) {
    rows.push(limitRow("Pool (7d)", 100 - pool.secondary, null));
  }

  return { rows, notes: [] };
}

export const openAICodexLbUsageProvider: UsageProvider = {
  id: "openai-codex-lb",
  label: "OpenAI Codex LB",
  async fetch(auth) {
    const body = await getJson<CodexLbUsageResponse>(resolveCodexLbUsageUrl(), {
      Authorization: `Bearer ${auth.token}`,
    });
    return parseCodexLbUsage(body);
  },
};
