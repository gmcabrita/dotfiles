/**
 * OpenCode Go subscription usage via `GET /zen/go/v1/usage`, authenticated
 * with the same OpenCode API key the opencode-go provider uses. Source:
 * anomalyco/opencode packages/console/app/src/routes/zen/go/v1/usage.ts.
 * Returns 403 EntitlementError when the key's workspace has no Go plan.
 */

import { limitRow, parseDate, type ProviderUsage, type UsageProvider } from "../model.ts";
import { getJson } from "./http.ts";

export const OPENCODE_GO_USAGE_ENDPOINT = "https://opencode.ai/zen/go/v1/usage";

interface OpenCodeGoWindow {
  status: "ok" | "rate-limited";
  percent: number;
  resetsAt: string;
}

export interface OpenCodeGoUsageResponse {
  usage: {
    rolling?: OpenCodeGoWindow | null;
    weekly?: OpenCodeGoWindow | null;
    monthly?: OpenCodeGoWindow | null;
  };
}

const WINDOWS = [
  ["rolling", "Rolling (5h)"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
] as const;

export function parseOpenCodeGoUsage(body: OpenCodeGoUsageResponse): ProviderUsage {
  const rows: ProviderUsage["rows"] = [];
  const notes: string[] = [];
  for (const [key, label] of WINDOWS) {
    const window = body.usage?.[key];
    if (!window) continue;
    const limited = window.status === "rate-limited";
    rows.push(limitRow(label, window.percent, parseDate(window.resetsAt), limited ? "critical" : undefined));
    if (limited) notes.push(`${label}: rate limited`);
  }
  return { rows, notes };
}

export const openCodeGoUsageProvider: UsageProvider = {
  id: "opencode-go",
  label: "OpenCode Go",
  async fetch(auth) {
    const body = await getJson<OpenCodeGoUsageResponse>(OPENCODE_GO_USAGE_ENDPOINT, {
      Authorization: `Bearer ${auth.token}`,
    });
    return parseOpenCodeGoUsage(body);
  },
};
