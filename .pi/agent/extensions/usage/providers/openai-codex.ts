/**
 * OpenAI Codex (ChatGPT subscription) usage via the same endpoint the Codex
 * CLI reads. Requires the `openai-codex` OAuth login; the account id header
 * is taken from the access token's JWT claims like pi's Codex adapter does.
 */

import { limitRow, parseDate, type ProviderUsage, type UsageProvider } from "../model.ts";
import { getJson } from "./http.ts";

export const OPENAI_CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

interface CodexWindow {
  used_percent: number;
  limit_window_seconds: number;
  reset_at: number;
}

interface CodexRateLimit {
  primary_window: CodexWindow | null;
  secondary_window: CodexWindow | null;
}

export interface OpenAICodexUsageResponse {
  plan_type?: string;
  rate_limit?: CodexRateLimit | null;
  additional_rate_limits?: { limit_name: string; rate_limit: CodexRateLimit }[] | null;
  credits?: { has_credits: boolean; unlimited: boolean; balance: string } | null;
}

function windowLabel(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  return `${Math.round(seconds / 60)}m`;
}

function pushWindows(rows: ProviderUsage["rows"], prefix: string, limit: CodexRateLimit | null | undefined): void {
  for (const window of [limit?.primary_window, limit?.secondary_window]) {
    if (!window) continue;
    rows.push(limitRow(`${prefix} (${windowLabel(window.limit_window_seconds)})`, window.used_percent, parseDate(window.reset_at)));
  }
}

export function parseOpenAICodexUsage(body: OpenAICodexUsageResponse): ProviderUsage {
  const rows: ProviderUsage["rows"] = [];
  pushWindows(rows, "Plan", body.rate_limit);
  for (const extra of body.additional_rate_limits ?? []) {
    pushWindows(rows, extra.limit_name, extra.rate_limit);
  }

  const notes: string[] = [];
  if (body.plan_type) notes.push(`Plan: ${body.plan_type}`);
  if (body.credits?.unlimited) notes.push("Credits: unlimited");
  else if (body.credits?.has_credits) notes.push(`Credits: ${body.credits.balance}`);

  return { rows, notes };
}

export function extractChatGptAccountId(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("openai-codex token is not a JWT");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  const claims = payload[JWT_CLAIM_PATH] as { chatgpt_account_id?: string } | undefined;
  if (!claims?.chatgpt_account_id) throw new Error("openai-codex token has no chatgpt_account_id claim");
  return claims.chatgpt_account_id;
}

export const openAICodexUsageProvider: UsageProvider = {
  id: "openai-codex",
  label: "OpenAI Codex (ChatGPT)",
  async fetch(auth) {
    if (auth.source !== "OAuth") {
      throw new Error("OAuth login required: run `pi auth login openai-codex`.");
    }
    const body = await getJson<OpenAICodexUsageResponse>(OPENAI_CODEX_USAGE_ENDPOINT, {
      Authorization: `Bearer ${auth.token}`,
      "chatgpt-account-id": extractChatGptAccountId(auth.token),
    });
    return parseOpenAICodexUsage(body);
  },
};
