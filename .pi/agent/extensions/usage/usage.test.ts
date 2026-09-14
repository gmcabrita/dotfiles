import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatProviderUsage, formatTimeUntil, formatUsageReport, progressBar, type ProviderResult } from "./model.ts";
import { type AnthropicUsageResponse, parseAnthropicUsage } from "./providers/anthropic.ts";
import { parseDeepSeekUsage } from "./providers/deepseek.ts";
import { extractChatGptAccountId, parseOpenAICodexUsage } from "./providers/openai-codex.ts";
import { parseCodexLbUsage, resolveCodexLbUsageUrl } from "./providers/openai-codex-lb.ts";
import { parseOpenRouterUsage } from "./providers/openrouter.ts";
import { scopedProviderIds, selectProviders } from "./index.ts";

const now = new Date("2026-09-14T18:54:00Z");

describe("parseAnthropicUsage", () => {
  const sample: AnthropicUsageResponse = {
    limits: [
      { kind: "session", percent: 2, severity: "normal", resets_at: "2026-09-14T22:40:00Z", scope: null },
      { kind: "weekly_all", percent: 2, severity: "normal", resets_at: "2026-09-21T14:00:00Z", scope: null },
      { kind: "weekly_scoped", percent: 75, severity: "warning", resets_at: "2026-09-21T14:00:00Z", scope: { model: { display_name: "Fable" } } },
    ],
    extra_usage: { is_enabled: false, utilization: null },
    seven_day_breakdown: { rows: [{ display_name: "Claude Code", percent: 100 }, { display_name: "Chats", percent: 0 }] },
  };

  it("uses the limits array and labels scoped rows by model", () => {
    const usage = parseAnthropicUsage(sample);
    assert.deepEqual(
      usage.rows.map((row) => row.kind === "limit" && [row.label, row.percent, row.severity]),
      [["Session (5h)", 2, "normal"], ["Weekly (all models)", 2, "normal"], ["Weekly (Fable)", 75, "warning"]],
    );
    assert.deepEqual(usage.notes, ["Weekly breakdown: Claude Code 100% · Chats 0%"]);
  });

  it("falls back to five_hour / seven_day", () => {
    const usage = parseAnthropicUsage({
      five_hour: { utilization: 95, resets_at: null },
      seven_day: { utilization: 40, resets_at: "2026-09-21T14:00:00Z" },
    });
    assert.deepEqual(
      usage.rows.map((row) => row.kind === "limit" && [row.label, row.percent, row.severity, row.resetsAt]),
      [["Session (5h)", 95, "critical", null], ["Weekly (all models)", 40, "normal", new Date("2026-09-21T14:00:00Z")]],
    );
  });
});

describe("parseOpenAICodexUsage", () => {
  it("renders plan and additional windows with reset epochs", () => {
    const usage = parseOpenAICodexUsage({
      plan_type: "pro",
      rate_limit: {
        primary_window: { used_percent: 17, limit_window_seconds: 604800, reset_at: 1789811771 },
        secondary_window: null,
      },
      additional_rate_limits: [
        {
          limit_name: "Spark",
          rate_limit: {
            primary_window: { used_percent: 0, limit_window_seconds: 18000, reset_at: 1789430444 },
            secondary_window: { used_percent: 91, limit_window_seconds: 604800, reset_at: 1790017244 },
          },
        },
      ],
      credits: { has_credits: false, unlimited: false, balance: "0" },
    });
    assert.deepEqual(
      usage.rows.map((row) => row.kind === "limit" && [row.label, row.percent, row.severity]),
      [["Plan (7d)", 17, "normal"], ["Spark (5h)", 0, "normal"], ["Spark (7d)", 91, "critical"]],
    );
    assert.equal(usage.rows[0].kind === "limit" && usage.rows[0].resetsAt?.getTime(), 1789811771 * 1000);
    assert.deepEqual(usage.notes, ["Plan: pro"]);
  });

  it("extracts the ChatGPT account id from the JWT", () => {
    const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc-1" } })).toString("base64url");
    assert.equal(extractChatGptAccountId(`h.${payload}.s`), "acc-1");
    assert.throws(() => extractChatGptAccountId("nope"));
  });
});

describe("parseCodexLbUsage", () => {
  it("labels key limits and pool windows and converts pool remaining to used percent", () => {
    const usage = parseCodexLbUsage({
      request_count: 1200,
      total_tokens: 34567,
      total_cost_usd: 1234.5,
      limits: [
        { limit_type: "cost_usd", limit_window: "weekly", max_value: 100, current_value: 25, remaining_value: 75, model_filter: null, reset_at: "2026-09-21T00:00:00Z", source: "api_key_limit" },
        { limit_type: "total_tokens", limit_window: "daily", max_value: 0, current_value: 0, remaining_value: 0, model_filter: "gpt-6", reset_at: "2026-09-15T00:00:00Z", source: "api_key_limit" },
      ],
      account_pool_usage: { primary: 60, secondary: null },
    });
    assert.deepEqual(
      usage.rows.map((row) => row.kind === "limit" && [row.label, row.percent]),
      [["Key weekly cost_usd", 25], ["Key daily total_tokens gpt-6", 0], ["Pool (5h)", 40]],
    );
    assert.deepEqual(usage.notes, []);
  });

  it("skips pool rows already covered by aggregate limits", () => {
    const usage = parseCodexLbUsage({
      request_count: 0,
      total_tokens: 0,
      total_cost_usd: 0,
      limits: [
        { limit_type: "credits", limit_window: "7d", max_value: 151200, current_value: 21672, remaining_value: 129528, model_filter: null, reset_at: "2026-09-19T09:56:07Z", source: "aggregate" },
      ],
      account_pool_usage: { primary: null, secondary: 85.67 },
    });
    assert.deepEqual(usage.rows.map((row) => row.kind === "limit" && [row.label, row.percent]), [["Pool (7d)", 14]]);
  });

  it("derives the usage URL from the configured base URL origin", () => {
    assert.equal(resolveCodexLbUsageUrl({ CODEX_LB_BASE_URL: "https://lb.example.com/backend-api" }), "https://lb.example.com/v1/usage");
  });
});

describe("parseOpenRouterUsage", () => {
  it("reports remaining credits as a balance", () => {
    const usage = parseOpenRouterUsage({ data: { total_credits: 95.37, total_usage: 2.29 } });
    assert.deepEqual(
      usage.rows.map((row) => row.kind === "balance" && [row.label, row.remaining.toFixed(2), row.total]),
      [["Balance (USD)", "93.08", null]],
    );
    assert.deepEqual(usage.notes, []);
  });
});

describe("parseDeepSeekUsage", () => {
  it("reports one balance row per currency", () => {
    const usage = parseDeepSeekUsage({
      is_available: true,
      balance_infos: [{ currency: "USD", total_balance: "50.92", granted_balance: "0.00", topped_up_balance: "50.92" }],
    });
    assert.deepEqual(usage.rows, [{ kind: "balance", label: "Balance (USD)", remaining: 50.92, total: null, currency: "USD" }]);
  });
});

describe("selectProviders", () => {
  const noop = async () => ({ rows: [], notes: [] });
  const providers = [
    { id: "anthropic", label: "A", fetch: noop },
    { id: "openrouter", label: "O", fetch: noop },
    { id: "deepseek", label: "D", fetch: noop },
  ];

  it("limits to providers of scoped models when no argument is given", () => {
    const scoped = scopedProviderIds([{ model: { provider: "anthropic" } }, { model: { provider: "opencode" } }]);
    assert.deepEqual(selectProviders(providers, "", scoped)?.map((p) => p.id), ["anthropic"]);
  });

  it("returns all providers when no scoping is configured", () => {
    assert.equal(selectProviders(providers, "", new Set())?.length, 3);
  });

  it("an explicit provider bypasses the scope filter", () => {
    const scoped = new Set(["anthropic"]);
    assert.deepEqual(selectProviders(providers, " DeepSeek ", scoped)?.map((p) => p.id), ["deepseek"]);
    assert.equal(selectProviders(providers, "nope", scoped), undefined);
  });
});

describe("formatting", () => {
  it("formats durations", () => {
    assert.equal(formatTimeUntil(new Date("2026-09-21T14:00:00Z"), now), "6d 19h");
    assert.equal(formatTimeUntil(new Date("2026-09-14T22:40:00Z"), now), "3h 46m");
    assert.equal(formatTimeUntil(new Date("2026-09-14T19:10:00Z"), now), "16m");
    assert.equal(formatTimeUntil(new Date("2026-09-14T18:00:00Z"), now), "now");
  });

  it("fills bars proportionally and clamps", () => {
    assert.equal(progressBar(0, 4), "░░░░");
    assert.equal(progressBar(50, 4), "██░░");
    assert.equal(progressBar(150, 4), "████");
  });

  it("renders limit and balance rows with aligned labels", () => {
    const lines = formatProviderUsage(
      {
        rows: [
          { kind: "limit", label: "Session (5h)", percent: 2, severity: "normal", resetsAt: new Date("2026-09-14T22:40:00Z") },
          { kind: "balance", label: "Credits", remaining: 93.08, total: 95.37, currency: "USD" },
          { kind: "balance", label: "Balance (USD)", remaining: 50.92, total: null, currency: "USD" },
        ],
        notes: ["note"],
      },
      now,
      undefined,
      10,
    );
    assert.match(lines[0], /^Session \(5h\)   ░░░░░░░░░░   2%  resets in 3h 46m \(/);
    assert.equal(lines[1], "Credits        ░░░░░░░░░░   2%  $93.08 of $95.37 remaining");
    assert.equal(lines[2], "Balance (USD)  $50.92 remaining");
    assert.equal(lines[3], "note");
  });

  it("renders a report with provider headers and errors", () => {
    const provider = { id: "x", label: "X", fetch: async () => ({ rows: [], notes: [] }) };
    const results: ProviderResult[] = [
      { provider, status: "ok", usage: { rows: [], notes: [] } },
      { provider: { ...provider, label: "Y" }, status: "error", message: "boom" },
    ];
    assert.deepEqual(formatUsageReport(results, now), ["X", "No usage data reported.", "", "Y", "boom"]);
  });
});
