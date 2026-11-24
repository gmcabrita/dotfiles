/**
 * abliteration.ai prepaid credits via `GET /v1/credits`. The endpoint accepts
 * the regular `ak_` inference key and returns the same body as OpenRouter's
 * `/api/v1/credits`, so the OpenRouter parser is reused.
 * Spec: https://api.abliteration.ai/openapi.json (operationId getCredits).
 */

import type { UsageProvider } from "../model.ts";
import { getJson } from "./http.ts";
import { type OpenRouterCreditsResponse, parseOpenRouterUsage } from "./openrouter.ts";

export const ABLITERATION_CREDITS_ENDPOINT = "https://api.abliteration.ai/v1/credits";

export const abliterationUsageProvider: UsageProvider = {
  id: "abliteration",
  label: "abliteration.ai",
  billing: "prepaid",
  async fetch(auth) {
    const credits = await getJson<OpenRouterCreditsResponse>(ABLITERATION_CREDITS_ENDPOINT, {
      Authorization: `Bearer ${auth.token}`,
    });
    return parseOpenRouterUsage(credits);
  },
};
