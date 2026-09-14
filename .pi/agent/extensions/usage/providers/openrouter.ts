/** OpenRouter remaining credits via `GET /api/v1/credits`. */

import { balanceRow, type ProviderUsage, type UsageProvider } from "../model.ts";
import { getJson } from "./http.ts";

export const OPENROUTER_CREDITS_ENDPOINT = "https://openrouter.ai/api/v1/credits";

export interface OpenRouterCreditsResponse {
  data: { total_credits: number; total_usage: number };
}

export function parseOpenRouterUsage(credits: OpenRouterCreditsResponse): ProviderUsage {
  const remaining = credits.data.total_credits - credits.data.total_usage;
  return { rows: [balanceRow("Balance (USD)", remaining, null)], notes: [] };
}

export const openRouterUsageProvider: UsageProvider = {
  id: "openrouter",
  label: "OpenRouter",
  async fetch(auth) {
    const credits = await getJson<OpenRouterCreditsResponse>(OPENROUTER_CREDITS_ENDPOINT, {
      Authorization: `Bearer ${auth.token}`,
    });
    return parseOpenRouterUsage(credits);
  },
};
