/**
 * Shared types and pure formatting for the /usage command.
 *
 * Each provider module converts its API payload into `ProviderUsage`; this
 * module renders those rows as terminal lines. No IO here.
 */

export type UsageSeverity = "normal" | "warning" | "critical";

/** A rate limit window rendered as a percent bar (subscription plans). */
export interface UsageLimitRow {
  kind: "limit";
  label: string;
  percent: number;
  severity: UsageSeverity;
  resetsAt: Date | null;
}

/** A prepaid or credit balance rendered as money (pay-as-you-go providers). */
export interface UsageBalanceRow {
  kind: "balance";
  label: string;
  remaining: number;
  /** Total credits when known; enables a percent bar. */
  total: number | null;
  currency: string;
}

export type UsageRow = UsageLimitRow | UsageBalanceRow;

export interface ProviderUsage {
  rows: UsageRow[];
  /** Extra one-line facts shown dimmed under the rows. */
  notes: string[];
}

/** Credentials pi resolved for a provider, passed to `UsageProvider.fetch`. */
export interface ProviderAuth {
  token: string;
  /** pi's auth source label, e.g. "OAuth" or "stored credential". */
  source: string | undefined;
}

export interface UsageProvider {
  /** pi provider id, e.g. "anthropic". Used for auth lookup and `/usage <id>` filtering. */
  id: string;
  label: string;
  fetch(auth: ProviderAuth): Promise<ProviderUsage>;
}

export function severityFromPercent(percent: number): UsageSeverity {
  if (percent >= 90) return "critical";
  if (percent >= 70) return "warning";
  return "normal";
}

export function limitRow(
  label: string,
  percent: number,
  resetsAt: Date | null,
  severity: UsageSeverity = severityFromPercent(percent),
): UsageLimitRow {
  return { kind: "limit", label, percent: Math.max(0, Math.round(percent)), severity, resetsAt };
}

export function balanceRow(label: string, remaining: number, total: number | null, currency = "USD"): UsageBalanceRow {
  return { kind: "balance", label, remaining, total, currency };
}

export function parseDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Human duration until `target`, e.g. "3h 46m", "6d 19h", "now". */
export function formatTimeUntil(target: Date, now: Date): string {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return "now";
  const totalMinutes = Math.ceil(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatLocalTime(date: Date, now: Date): string {
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day} ${time}`;
}

export function formatMoney(amount: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${amount.toFixed(2)}`;
}

export function progressBar(percent: number, width: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export interface UsageStyle {
  bold: (text: string) => string;
  dim: (text: string) => string;
  severity: (severity: UsageSeverity, text: string) => string;
}

export const plainStyle: UsageStyle = {
  bold: (text) => text,
  dim: (text) => text,
  severity: (_severity, text) => text,
};

/** Render one provider's rows. `now` is injected for testability. */
export function formatProviderUsage(
  usage: ProviderUsage,
  now: Date,
  style: UsageStyle = plainStyle,
  barWidth = 20,
): string[] {
  const lines: string[] = [];
  if (usage.rows.length === 0) lines.push(style.dim("No usage data reported."));

  const labelWidth = Math.max(0, ...usage.rows.map((row) => row.label.length));
  for (const row of usage.rows) {
    const label = row.label.padEnd(labelWidth);
    if (row.kind === "limit") {
      const bar = style.severity(row.severity, progressBar(row.percent, barWidth));
      const percent = style.severity(row.severity, `${String(row.percent).padStart(3)}%`);
      const reset = row.resetsAt
        ? style.dim(`resets in ${formatTimeUntil(row.resetsAt, now)} (${formatLocalTime(row.resetsAt, now)})`)
        : "";
      lines.push(`${label}  ${bar} ${percent}  ${reset}`.trimEnd());
      continue;
    }

    const remaining = formatMoney(row.remaining, row.currency);
    if (row.total === null || row.total <= 0) {
      const severity = row.remaining <= 0 ? "critical" : row.remaining < 5 ? "warning" : "normal";
      lines.push(`${label}  ${style.severity(severity, `${remaining} remaining`)}`);
      continue;
    }
    const usedPercent = Math.max(0, Math.min(100, ((row.total - row.remaining) / row.total) * 100));
    const severity = severityFromPercent(usedPercent);
    const bar = style.severity(severity, progressBar(usedPercent, barWidth));
    const percent = style.severity(severity, `${String(Math.round(usedPercent)).padStart(3)}%`);
    const detail = style.dim(`${remaining} of ${formatMoney(row.total, row.currency)} remaining`);
    lines.push(`${label}  ${bar} ${percent}  ${detail}`);
  }

  for (const note of usage.notes) lines.push(style.dim(note));
  return lines;
}

/** Result of one provider fetch, ready for rendering. */
export type ProviderResult =
  | { provider: UsageProvider; status: "ok"; usage: ProviderUsage }
  | { provider: UsageProvider; status: "error"; message: string };

/** Render all provider sections separated by blank lines. */
export function formatUsageReport(
  results: ProviderResult[],
  now: Date,
  style: UsageStyle = plainStyle,
  barWidth = 20,
): string[] {
  const lines: string[] = [];
  results.forEach((result, index) => {
    if (index > 0) lines.push("");
    lines.push(style.bold(result.provider.label));
    if (result.status === "error") {
      lines.push(style.severity("critical", result.message));
      return;
    }
    lines.push(...formatProviderUsage(result.usage, now, style, barWidth));
  });
  return lines;
}
