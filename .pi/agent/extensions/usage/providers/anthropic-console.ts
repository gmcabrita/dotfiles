/**
 * Claude Console (platform.claude.com) API credits, such as the monthly
 * "API credit (Max)" grant. Only a Console login session can read them: API
 * keys, including org-wide ones, are refused. The session lasts about a week,
 * so the requests run inside the user's logged-in browser through `browse`
 * instead of storing it.
 */

import { execFile } from "node:child_process";
import { balanceRow, type BrowserUsageProvider, type ProviderUsage } from "../model.ts";

export const CONSOLE_ORIGIN = "https://platform.claude.com";
export const CONSOLE_LOGIN_URL = `${CONSOLE_ORIGIN}/login`;

const TAB_ID = "usage-claude-console";
const BROWSE_TIMEOUT_MS = 45_000;

export interface ConsoleResponse {
  status: number;
  body: string;
}

interface ConsoleOrganization {
  uuid: string;
  name?: string;
  capabilities?: string[];
}

interface ConsoleTranche {
  name?: string | null;
  currency: string;
  remaining_amount_minor_units: number;
  granted_amount_minor_units: number;
  expires_at: string | null;
}

export interface ConsoleCreditsResponse {
  amount: number;
  currency: string;
  tranches?: ConsoleTranche[] | null;
  promo_tranches?: ConsoleTranche[] | null;
}

function checkResponse(response: ConsoleResponse): void {
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Logged out of platform.claude.com. Log in at ${CONSOLE_LOGIN_URL}, then press r.`);
  }
  if (response.status !== 200) throw new Error(`HTTP ${response.status} from platform.claude.com`);
}

/** The Console org that holds API credits; a Max account also has a chat-only org. */
export function findApiOrganization(response: ConsoleResponse): string {
  checkResponse(response);
  const organizations = JSON.parse(response.body) as ConsoleOrganization[];
  const organization = organizations.find((candidate) => candidate.capabilities?.includes("api"));
  if (!organization) throw new Error("No Claude Console organization with API access");
  return organization.uuid;
}

function formatExpiry(expiresAt: string): string {
  return new Date(expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function parseConsoleCredits(response: ConsoleResponse): ProviderUsage {
  checkResponse(response);
  const credits = JSON.parse(response.body) as ConsoleCreditsResponse;
  const tranches = [...(credits.promo_tranches ?? []), ...(credits.tranches ?? [])];
  if (tranches.length === 0) {
    return { rows: [balanceRow(`Balance (${credits.currency})`, credits.amount / 100, null, credits.currency)], notes: [] };
  }

  const rows = tranches.map((tranche) =>
    balanceRow(
      tranche.name ?? "Credit",
      tranche.remaining_amount_minor_units / 100,
      tranche.granted_amount_minor_units / 100,
      tranche.currency,
    ),
  );
  const notes = tranches.flatMap((tranche) =>
    tranche.expires_at ? [`${tranche.name ?? "Credit"} expires ${formatExpiry(tranche.expires_at)}`] : [],
  );
  return { rows, notes };
}

function runBrowse(args: Record<string, unknown>, tool: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile("browse", [tool, "--json", JSON.stringify(args)], { timeout: BROWSE_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        reject(new Error(missing ? "browse CLI not found" : `browse ${tool} failed: ${stderr.trim() || error.message}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`browse ${tool} returned unexpected output`));
      }
    });
  });
}

/** Same-origin fetch in the Console tab, so the browser attaches its own session cookie. */
async function consoleGet(path: string): Promise<ConsoleResponse> {
  const result = await runBrowse(
    {
      tab: TAB_ID,
      arg: path,
      expression:
        'async (_, path) => { const response = await fetch(path, { headers: { Accept: "application/json" } }); return { status: response.status, body: await response.text() }; }',
    },
    "eval",
  );
  return result as ConsoleResponse;
}

export const anthropicConsoleUsageProvider: BrowserUsageProvider = {
  id: "anthropic-console",
  label: "Anthropic API credits",
  billing: "prepaid",
  browserSession: true,
  async fetch() {
    // A tiny same-origin page is enough for fetch to carry the Console session.
    await runBrowse(
      {
        action: "new",
        id: TAB_ID,
        url: `${CONSOLE_ORIGIN}/robots.txt`,
        allowedOrigins: ["platform.claude.com"],
        readOnly: true,
        group: "usage",
      },
      "tabs",
    );
    try {
      const organization = findApiOrganization(await consoleGet("/api/organizations"));
      return parseConsoleCredits(await consoleGet(`/api/organizations/${organization}/prepaid/credits`));
    } finally {
      await runBrowse({ action: "close", tab: TAB_ID }, "tabs").catch(() => undefined);
    }
  },
};
