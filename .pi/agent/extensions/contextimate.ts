import type { Component } from "@earendil-works/pi-tui";
import type { ContextUsage, ExtensionAPI, ExtensionContext, SessionEntry, Theme, ThemeColor, ToolInfo } from "@earendil-works/pi-coding-agent";
import { buildSessionContext, convertToLlm, keyText } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type ViewMode = "summary" | "compact";
const VIEW_MODES: readonly ViewMode[] = ["summary", "compact"];
type SelectableKind = "section" | "skill" | "tool";
type CompactSelection = { kind: SelectableKind; name: string };

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type SkillSummary = {
  name: string;
  description: string;
  location: string;
  chars: number;
  tokens: number;
};

type ToolSummary = {
  name: string;
  description: string;
  source: string;
  schema: unknown;
  promptGuidelines: string[];
};

type ScanRow = {
  name: string;
  tokens?: number;
  desc?: string;
  inactive?: boolean;
  kind?: SelectableKind;
};

type PrefixSection = {
  id: string;
  title: string;
  content: string;
  /** Tools only: formula-derived tokens replacing the ch ÷ denominator estimate. */
  effectiveTokens?: number;
  /** Tools only: minified-payload size, when content.length is not the counted chars. */
  rawChars?: number;
  denominator: number;
  compactRows?: ScanRow[];
  selectable?: boolean;
};

type ModelSummary = {
  provider: string;
  id: string;
  api: string;
};

type HeuristicProfile = Partial<Pick<ResolvedHeuristic, "label" | "textDenominator" | "sessionDenominator" | "toolDenominator" | "toolNumerator">>;

type HeuristicRule = HeuristicProfile & {
  profile?: string;
  match?: {
    provider?: string;
    model?: string;
    id?: string;
    api?: string;
  };
};

type ContextimateConfig = {
  profiles?: Record<string, HeuristicProfile>;
  defaults?: Partial<Pick<ResolvedHeuristic, "textDenominator" | "sessionDenominator" | "toolDenominator" | "toolNumerator">> & { profile?: string };
  rules?: HeuristicRule[];
};

type ResolvedHeuristic = {
  label: string;
  source: string;
  textDenominator: number;
  sessionDenominator: number;
  toolDenominator: number;
  toolNumerator: string;
};

type BuiltInHeuristicRule = {
  label: string;
  providerIncludes: string[];
  apiEquals: string[];
  modelRegex?: RegExp;
  textDenominator: number;
  sessionDenominator: number;
  toolDenominator: number;
  toolNumerator: string;
};

type ToolNumeratorResult = {
  label: string;
  content: string;
  chars: number;
  /** Present only for the openai-cookbook formula; ratio shapes divide chars instead. */
  tokens?: number;
};

type ToolDisplayEstimate = {
  tokens: number;
  chars: number;
};

type SessionBreakdown = {
  thinkingChars: number;
  toolOutputChars: number;
  messageChars: number;
  messageCount: number;
};

/** The slice of pi's ReadonlySessionManager the session walk needs. */
type SessionSource = {
  getEntries(): SessionEntry[];
  getLeafId(): string | null;
};

type PrefixSnapshot = {
  signature: string;
  sections: PrefixSection[];
  tools: ToolSummary[];
  allTools: ToolSummary[];
  skills: SkillSummary[];
  heuristic: ResolvedHeuristic;
  model?: ModelSummary;
  session?: SessionBreakdown;
  contextUsage?: ContextUsage;
};

const PROJECT_CONTEXT_RE = /\n?<project_context>\n\n[\s\S]*?\n<\/project_context>\n?/;
const PROJECT_INSTRUCTIONS_RE = /<project_instructions path="([^"]*)">\n([\s\S]*?)\n<\/project_instructions>/g;
const AVAILABLE_SKILLS_RE = /\n\nThe following skills provide specialized instructions for specific tasks\.[\s\S]*?<available_skills>[\s\S]*?<\/available_skills>/;
const SKILL_RE = /<skill>\s*<name>([\s\S]*?)<\/name>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<location>([\s\S]*?)<\/location>\s*<\/skill>/g;
const DEFAULT_MODE: ViewMode = "summary";
const OPENAI_TOOL_TEXT_FRAGMENT_DENOMINATOR = 6.6;
const ELLIPSIS = "…";
const GLYPH = { section: "▸" } as const;
const SEP = " · ";

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function positiveNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function expandHomePath(filePath: string): string {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/")) return join(homedir(), filePath.slice(2));
  return filePath;
}

function readJsonConfig<T>(filePath: string, parse: (value: unknown) => T): T | undefined {
  try {
    const expanded = expandHomePath(filePath);
    if (!existsSync(expanded)) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(expanded, "utf8"));
    return parse(parsed);
  } catch {
    return undefined;
  }
}

function configPaths(name: string, cwd: string): string[] {
  return [join(homedir(), ".pi", "agent", `${name}.json`), join(cwd, ".pi", `${name}.json`)];
}

function compactCount(value: number): string {
  if (!Number.isFinite(value)) return "?";
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 999_950) return `${(rounded / 1_000_000).toFixed(1)}M`;
  return `${(rounded / 1000).toFixed(1)}k`;
}

function ink(theme: Theme | undefined, role: ThemeColor, text: string): string {
  if (!theme || text.length === 0) return text;
  try {
    return theme.fg(role, text);
  } catch {
    return text;
  }
}

function panelHeader(
  theme: Theme | undefined,
  name: string,
  options: { modes?: readonly string[]; active?: string; hint?: string } = {},
): string[] {
  const bold = (text: string) => {
    try {
      return theme?.bold ? theme.bold(text) : text;
    } catch {
      return text;
    }
  };
  const brand = ink(theme, "accent", bold(`[${name}]`));
  const pips = options.modes && options.active
    ? ` ${options.modes.map((mode) => mode === options.active ? ink(theme, "accent", bold(mode)) : ink(theme, "dim", mode)).join(ink(theme, "dim", " → "))}`
    : "";
  const lines = [`${brand}${pips}`];
  if (options.hint) lines.push(`  ${ink(theme, "dim", options.hint)}`);
  return lines;
}

// The family accent (design language §3): theme-derived, used sparingly — the panel
// brand, token figures, total rows, and the carried part of the context bar.
function accent(theme: Theme | undefined, text: string): string {
  return ink(theme, "accent", text);
}

type TokenLabelLayout = { unitWidth: number; fieldWidth: number };

function tokenIntegerWidth(tokens: number): number {
  return compactCount(tokens).split(".", 1)[0].length;
}

function estimatedTokenLabel(tokens: number, layout: TokenLabelLayout = tokenLabelLayout([tokens])): string {
  const leftPad = " ".repeat(Math.max(0, layout.unitWidth - tokenIntegerWidth(tokens)));
  return `${leftPad}~${compactCount(tokens)}`;
}

function estimatedTokenField(tokens: number, layout: TokenLabelLayout): string {
  return estimatedTokenLabel(tokens, layout).padEnd(layout.fieldWidth, " ");
}

function exactTokenLabel(tokens: number, layout: TokenLabelLayout = tokenLabelLayout([tokens])): string {
  const leftPad = " ".repeat(Math.max(0, layout.unitWidth - tokenIntegerWidth(tokens)) + 1);
  return `${leftPad}${compactCount(tokens)}`;
}

function tokenLabelLayout(tokens: number[]): TokenLabelLayout {
  const unitWidth = Math.max(0, ...tokens.map(tokenIntegerWidth));
  const rawLabels = tokens.map((token) => {
    const leftPad = " ".repeat(Math.max(0, unitWidth - tokenIntegerWidth(token)));
    return `${leftPad}~${compactCount(token)}`;
  });
  return { unitWidth, fieldWidth: Math.max(0, ...rawLabels.map((label) => label.length)) };
}

function formatPercent(value: number | null): string | undefined {
  if (value === null || !Number.isFinite(value)) return undefined;
  return `${value.toFixed(1)}%`;
}

function cleanDenominator(value: unknown, fallback = 4): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

// Denominators are sanitized once, at heuristic resolution (applyHeuristicPatch); by
// the time one reaches a count it is a trusted positive number.
function estimateCharsAsTokens(chars: number, denominator: number): number {
  return Math.ceil(chars / denominator);
}

function formatDenominator(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

// --- the family number grammar: `~0.5k tokens (1.2k ch ÷ 2.6)` -------------------------

function ratioDetail(denominator: number): string {
  return `÷ ${formatDenominator(denominator)}`;
}

function countDetail(chars: number, detail?: string): string {
  return `(${compactCount(chars)} ch${detail ? ` ${detail}` : ""})`;
}

function compactPath(filePath: string): string {
  const home = homedir();
  if (filePath === `${home}/.pi/agent/AGENTS.md`) return "Global AGENTS.md";
  if (filePath.startsWith(`${home}/`)) return `~/${filePath.slice(home.length + 1)}`;
  return filePath;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "undefined";
  } catch (error) {
    return `[unserializable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

function safeMinifiedJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch (error) {
    return `[unserializable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

function normalizeBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function singleLine(text: string, max = 140): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function getPromptRemainder(systemPrompt: string): string {
  return normalizeBlankLines(
    systemPrompt.replace(PROJECT_CONTEXT_RE, "\n").replace(AVAILABLE_SKILLS_RE, "\n"),
  );
}

function parseSkills(content: string, denominator: number): SkillSummary[] {
  return [...content.matchAll(SKILL_RE)].map((m) => {
    const chars = (m[0] ?? "").length;
    return {
      name: unescapeXml((m[1] ?? "").trim()),
      description: unescapeXml((m[2] ?? "").trim()),
      location: unescapeXml((m[3] ?? "").trim()),
      chars,
      tokens: estimateCharsAsTokens(chars, denominator),
    };
  });
}

function parseContextSections(systemPrompt: string, denominator: number): PrefixSection[] {
  const sections: PrefixSection[] = [];
  for (const match of systemPrompt.matchAll(PROJECT_INSTRUCTIONS_RE)) {
    const [, rawPath, content] = match;
    const filePath = rawPath ?? "";
    const title = compactPath(filePath);
    sections.push({
      id: `context:${filePath}`,
      title,
      content: content ?? "",
      denominator,
      selectable: true,
    });
  }
  return sections;
}

function buildSkillsSection(systemPrompt: string, denominator: number): { section?: PrefixSection; skills: SkillSummary[] } {
  const match = systemPrompt.match(AVAILABLE_SKILLS_RE);
  if (!match) return { skills: [] };
  const content = match[0].trim();
  const skills = parseSkills(content, denominator);
  const sortedSkills = [...skills].sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
  const scanRows = sortedSkills.map((skill) => ({
    name: skill.name,
    tokens: skill.tokens,
    desc: skill.description,
    kind: "skill" as const,
  }));
  return {
    skills,
    section: {
      id: "skills",
      title: `Skill frontmatter (${skills.length})`,
      content,
      denominator,
      compactRows: scanRows,
    },
  };
}

// Provenance short form (design language §8): the local defining path *is* the
// audit trail, and the origin URL / package ref / `top-level` decorations duplicate
// it, so the label is `scope · path` (falling back to the loader source when no path
// exists) and builtins collapse to one word. Pi keeps the full SourceInfo.
function sourceInfoLabel(tool: ToolInfo): string {
  const sourceInfo = tool.sourceInfo;
  if (sourceInfo.source === "builtin") return "builtin";
  const where = sourceInfo.path ?? sourceInfo.source;
  return [sourceInfo.scope, where].filter(Boolean).join(SEP) || "unknown";
}

function summarizeTool(tool: ToolInfo): ToolSummary {
  return {
    name: tool.name,
    description: tool.description.trim() || "(no description)",
    source: sourceInfoLabel(tool),
    schema: tool.parameters,
    promptGuidelines: tool.promptGuidelines ?? [],
  };
}

// pi does not re-export pi-ai's Model type; ctx.model carries it.
type PiModel = NonNullable<ExtensionContext["model"]>;

function toModelSummary(model: PiModel | undefined): ModelSummary | undefined {
  return model ? { provider: model.provider, id: model.id, api: model.api } : undefined;
}

function modelLabel(model?: ModelSummary): string {
  return model ? `${model.provider}/${model.id}` : "unknown model";
}

function mergeContextimateConfig(base: ContextimateConfig, next?: ContextimateConfig): ContextimateConfig {
  if (!next) return base;
  return {
    ...base,
    ...next,
    defaults: { ...(base.defaults ?? {}), ...(next.defaults ?? {}) },
    profiles: { ...(base.profiles ?? {}), ...(next.profiles ?? {}) },
    rules: [...(base.rules ?? []), ...(Array.isArray(next.rules) ? next.rules : [])],
  };
}

function parseHeuristicProfile(value: unknown): HeuristicProfile {
  if (!isJsonObject(value)) return {};
  const profile: HeuristicProfile = {};
  const label = stringValue(value.label);
  const textDenominator = positiveNumberValue(value.textDenominator);
  const sessionDenominator = positiveNumberValue(value.sessionDenominator);
  const toolDenominator = positiveNumberValue(value.toolDenominator);
  const toolNumerator = stringValue(value.toolNumerator);
  if (label) profile.label = label;
  if (textDenominator) profile.textDenominator = textDenominator;
  if (sessionDenominator) profile.sessionDenominator = sessionDenominator;
  if (toolDenominator) profile.toolDenominator = toolDenominator;
  if (toolNumerator) profile.toolNumerator = toolNumerator;
  return profile;
}

function parseHeuristicRule(value: unknown): HeuristicRule | undefined {
  if (!isJsonObject(value)) return undefined;
  const rule: HeuristicRule = parseHeuristicProfile(value);
  const profile = stringValue(value.profile);
  if (profile) rule.profile = profile;
  if (isJsonObject(value.match)) {
    const match: NonNullable<HeuristicRule["match"]> = {};
    const provider = stringValue(value.match.provider);
    const model = stringValue(value.match.model);
    const id = stringValue(value.match.id);
    const api = stringValue(value.match.api);
    if (provider) match.provider = provider;
    if (model) match.model = model;
    if (id) match.id = id;
    if (api) match.api = api;
    if (Object.keys(match).length > 0) rule.match = match;
  }
  return Object.keys(rule).length > 0 ? rule : undefined;
}

function parseContextimateConfig(value: unknown): ContextimateConfig {
  if (!isJsonObject(value)) return {};
  const config: ContextimateConfig = {};
  if (isJsonObject(value.defaults)) {
    const defaults: NonNullable<ContextimateConfig["defaults"]> = parseHeuristicProfile(value.defaults);
    const profile = stringValue(value.defaults.profile);
    if (profile) defaults.profile = profile;
    if (Object.keys(defaults).length > 0) config.defaults = defaults;
  }
  if (isJsonObject(value.profiles)) {
    const profiles: Record<string, HeuristicProfile> = {};
    for (const [name, entry] of Object.entries(value.profiles)) {
      const profile = parseHeuristicProfile(entry);
      if (Object.keys(profile).length > 0) profiles[name] = profile;
    }
    if (Object.keys(profiles).length > 0) config.profiles = profiles;
  }
  if (Array.isArray(value.rules)) {
    const rules = value.rules.map(parseHeuristicRule).filter((rule): rule is HeuristicRule => !!rule);
    if (rules.length > 0) config.rules = rules;
  }
  return config;
}

function splitConfigPaths(value: string | undefined): string[] {
  return (value ?? "").split(":").map((entry) => expandHomePath(entry.trim())).filter(Boolean);
}

function loadContextimateConfig(cwd: string): ContextimateConfig {
  const paths = [...configPaths("pi-contextimate", cwd), ...splitConfigPaths(process.env.PI_CONTEXTIMATE_CONFIG)];
  return paths.reduce<ContextimateConfig>(
    (config, filePath) => mergeContextimateConfig(config, readJsonConfig(filePath, parseContextimateConfig)),
    {},
  );
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesPattern(value: string, pattern?: string): boolean {
  if (!pattern) return true;
  if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
    const end = pattern.lastIndexOf("/");
    try {
      return new RegExp(pattern.slice(1, end), pattern.slice(end + 1) || undefined).test(value);
    } catch {
      return false;
    }
  }
  if (pattern.includes("*") || pattern.includes("?")) return globToRegex(pattern).test(value);
  return value.toLowerCase() === pattern.toLowerCase();
}

function ruleMatchesModel(rule: HeuristicRule, model?: ModelSummary): boolean {
  const match = rule.match;
  if (!match) return true;
  const provider = model?.provider ?? "";
  const id = model?.id ?? "";
  const api = model?.api ?? "";
  return matchesPattern(provider, match.provider)
    && matchesPattern(id, match.model ?? match.id)
    && matchesPattern(api, match.api);
}

function defaultHeuristic(): ResolvedHeuristic {
  return {
    label: "fallback chars/4",
    source: "fallback",
    textDenominator: 4,
    sessionDenominator: 4,
    toolDenominator: 4,
    toolNumerator: "openai-responses",
  };
}

function applyHeuristicPatch(base: ResolvedHeuristic, patch: HeuristicProfile | Partial<ResolvedHeuristic> | undefined, source: string): ResolvedHeuristic {
  const normalized: Partial<ResolvedHeuristic> = patch ? {
    label: patch.label,
    textDenominator: patch.textDenominator,
    sessionDenominator: patch.sessionDenominator,
    toolDenominator: patch.toolDenominator,
    toolNumerator: patch.toolNumerator,
  } : {};
  return {
    ...base,
    ...normalized,
    // An absent label in a patch must not clobber the base label: unknown providers
    // otherwise reach renderHeader with label undefined and crash methodologyHint.
    label: normalized.label ?? base.label,
    source,
    textDenominator: cleanDenominator(normalized.textDenominator, base.textDenominator),
    sessionDenominator: cleanDenominator(normalized.sessionDenominator, base.sessionDenominator),
    toolDenominator: cleanDenominator(normalized.toolDenominator, base.toolDenominator),
    toolNumerator: normalized.toolNumerator ?? base.toolNumerator,
  };
}

const BUILT_IN_HEURISTIC_RULES: BuiltInHeuristicRule[] = [
  {
    label: "Claude 4.7+ heuristic",
    providerIncludes: ["anthropic"],
    apiEquals: ["anthropic-messages"],
    modelRegex: /claude.*4[-.]?[78]|4[-.]?[78].*claude/,
    textDenominator: 2.6,
    sessionDenominator: 2.6,
    toolDenominator: 2.6,
    toolNumerator: "anthropic",
  },
  {
    label: "Claude 4.5/4.6 heuristic",
    providerIncludes: ["anthropic"],
    apiEquals: ["anthropic-messages"],
    modelRegex: /claude.*4[-.]?[56]|4[-.]?[56].*claude/,
    textDenominator: 3.8,
    sessionDenominator: 3.5,
    toolDenominator: 3.3,
    toolNumerator: "anthropic",
  },
  {
    label: "Anthropic heuristic",
    providerIncludes: ["anthropic"],
    apiEquals: ["anthropic-messages"],
    textDenominator: 3.5,
    sessionDenominator: 3.5,
    toolDenominator: 3.3,
    toolNumerator: "anthropic",
  },
  {
    label: "OpenAI-Codex heuristic",
    providerIncludes: ["openai-codex"],
    apiEquals: ["openai-codex-responses"],
    textDenominator: 4,
    sessionDenominator: 4,
    toolDenominator: 5.5,
    toolNumerator: "openai-cookbook",
  },
  {
    label: "OpenAI Responses heuristic",
    providerIncludes: ["openai"],
    apiEquals: ["openai-responses", "azure-openai-responses"],
    textDenominator: 4,
    sessionDenominator: 4,
    toolDenominator: 5.5,
    toolNumerator: "openai-responses",
  },
  {
    label: "OpenAI-chat-style heuristic",
    providerIncludes: ["mistral"],
    apiEquals: ["openai-completions", "mistral-conversations"],
    textDenominator: 4,
    sessionDenominator: 4,
    toolDenominator: 5.5,
    toolNumerator: "openai-chat",
  },
  {
    label: "Gemini/Vertex heuristic",
    providerIncludes: ["google", "gemini"],
    apiEquals: ["google-generative-ai", "google-vertex"],
    textDenominator: 4,
    sessionDenominator: 4,
    toolDenominator: 4,
    toolNumerator: "gemini",
  },
  {
    label: "Bedrock heuristic",
    providerIncludes: ["bedrock"],
    apiEquals: ["bedrock-converse-stream"],
    textDenominator: 4,
    sessionDenominator: 4,
    toolDenominator: 4,
    toolNumerator: "bedrock",
  },
];

function builtInRuleMatches(rule: BuiltInHeuristicRule, model: ModelSummary): boolean {
  const provider = model.provider.toLowerCase();
  const api = model.api.toLowerCase();
  const providerOrApiMatches = rule.providerIncludes.some((entry) => provider.includes(entry))
    || rule.apiEquals.includes(api);
  const modelMatches = rule.modelRegex ? rule.modelRegex.test(model.id.toLowerCase()) : true;
  return providerOrApiMatches && modelMatches;
}

function builtInHeuristicForModel(model?: ModelSummary): Partial<ResolvedHeuristic> | undefined {
  if (!model) return undefined;
  const rule = BUILT_IN_HEURISTIC_RULES.find((candidate) => builtInRuleMatches(candidate, model));
  if (!rule) return undefined;
  return {
    label: rule.label,
    textDenominator: rule.textDenominator,
    sessionDenominator: rule.sessionDenominator,
    toolDenominator: rule.toolDenominator,
    toolNumerator: rule.toolNumerator,
  };
}

// Heuristic resolution is one flat candidate list merged left to right with a single
// patch function: fallback < defaults.profile < defaults < built-in model rule <
// matching config rules (each optionally pulling in a named profile first).
function resolveHeuristic(model: ModelSummary | undefined, config: ContextimateConfig): ResolvedHeuristic {
  const candidates: Array<{ patch: HeuristicProfile | Partial<ResolvedHeuristic> | undefined; source: string }> = [];
  const defaults = config.defaults ?? {};
  if (defaults.profile && config.profiles?.[defaults.profile]) {
    candidates.push({ patch: config.profiles[defaults.profile], source: `profile:${defaults.profile}` });
  }
  candidates.push({ patch: defaults, source: "configured defaults" });
  const builtIn = builtInHeuristicForModel(model);
  if (builtIn) candidates.push({ patch: builtIn, source: builtIn.label ?? "provider-aware heuristic" });
  for (const rule of config.rules ?? []) {
    if (!ruleMatchesModel(rule, model)) continue;
    if (rule.profile && config.profiles?.[rule.profile]) {
      candidates.push({ patch: config.profiles[rule.profile], source: `profile:${rule.profile}` });
    }
    candidates.push({ patch: rule, source: rule.label ?? (rule.profile ? `rule:${rule.profile}` : "custom rule") });
  }
  return candidates.reduce(
    (heuristic, { patch, source }) => applyHeuristicPatch(heuristic, patch, source),
    defaultHeuristic(),
  );
}

function openAIResponsesToolPayload(tool: ToolSummary): unknown {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.schema,
    strict: null,
  };
}

function openAIChatToolPayload(tool: ToolSummary): unknown {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
      strict: null,
    },
  };
}

function anthropicToolPayload(tool: ToolSummary): unknown {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.schema,
  };
}

function geminiToolPayload(tools: ToolSummary[]): unknown {
  return {
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parametersJsonSchema: tool.schema,
    })),
  };
}

function bedrockToolPayload(tool: ToolSummary): unknown {
  return {
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: { json: tool.schema },
    },
  };
}

function rawToolPayload(tool: ToolSummary): unknown {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.schema,
    promptGuidelines: tool.promptGuidelines,
  };
}

function toolPayloadForShape(tool: ToolSummary, shape: string): unknown {
  switch (shape) {
    case "openai-chat":
    case "openai-completions":
    case "mistral":
      return openAIChatToolPayload(tool);
    case "anthropic":
      return anthropicToolPayload(tool);
    case "gemini":
    case "google":
    case "vertex":
      return { name: tool.name, description: tool.description, parametersJsonSchema: tool.schema };
    case "bedrock":
      return bedrockToolPayload(tool);
    case "raw-schema":
      return rawToolPayload(tool);
    default:
      return openAIResponsesToolPayload(tool);
  }
}

function aggregateToolPayloadForShape(tools: ToolSummary[], shape: string): unknown {
  if (shape === "gemini" || shape === "google" || shape === "vertex") return geminiToolPayload(tools);
  return tools.map((tool) => toolPayloadForShape(tool, shape));
}

function toolPayloadLabel(shape: string): string {
  switch (shape) {
    case "openai-responses":
    case "openai-codex-responses":
      return "OpenAI Responses tool payload";
    case "openai-chat":
    case "openai-completions":
    case "mistral":
      return "OpenAI Chat tool payload";
    case "anthropic":
      return "Anthropic tool payload";
    case "gemini":
    case "google":
    case "vertex":
      return "Gemini/Vertex tool payload";
    case "bedrock":
      return "Bedrock tool payload";
    case "raw-schema":
      return "Raw tool schema payload";
    default:
      return `Unknown tool shape ${shape}; OpenAI Responses fallback`;
  }
}

function buildToolNumerator(tools: ToolSummary[], heuristic: ResolvedHeuristic): ToolNumeratorResult {
  const shape = heuristic.toolNumerator;
  if (shape === "openai-cookbook") {
    const content = safeMinifiedJson(tools.map(openAIResponsesToolPayload));
    return {
      label: "OpenAI-style local formula",
      content,
      chars: content.length,
      tokens: estimateOpenAIFunctionToolTokens(tools),
    };
  }
  const content = safeMinifiedJson(aggregateToolPayloadForShape(tools, shape));
  return {
    label: toolPayloadLabel(shape),
    content,
    chars: content.length,
  };
}

function trimFinalPeriod(text: string): string {
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

function getSchemaProperties(schema: unknown): Record<string, unknown> {
  if (!isJsonObject(schema) || !isJsonObject(schema.properties)) return {};
  return schema.properties;
}

function schemaPropertyType(property: unknown): string {
  if (!isJsonObject(property)) return "object";
  if (typeof property.type === "string") return property.type;
  if (Array.isArray(property.type)) return property.type.filter((entry): entry is string => typeof entry === "string").join("|");
  if (property.anyOf) return "anyOf";
  if (property.oneOf) return "oneOf";
  if (property.allOf) return "allOf";
  return "object";
}

function schemaPropertyDescription(property: unknown): string {
  if (!isJsonObject(property)) return "";
  return typeof property.description === "string" ? trimFinalPeriod(property.description) : "";
}

function schemaPropertyEnum(property: unknown): JsonValue[] {
  if (!isJsonObject(property) || !Array.isArray(property.enum)) return [];
  return property.enum;
}

function schemaArrayItemProperties(property: unknown): Record<string, unknown> {
  if (!isJsonObject(property)) return {};
  return getSchemaProperties(property.items);
}

function estimateOpenAIToolTextTokens(text: string): number {
  return estimateCharsAsTokens(text.length, OPENAI_TOOL_TEXT_FRAGMENT_DENOMINATOR);
}

function estimateOpenAIToolDefinitionTokens(tool: ToolSummary): number {
  let tokens = 7;
  tokens += estimateOpenAIToolTextTokens(`${tool.name}:${trimFinalPeriod(tool.description)}`);
  const propertyEntries = Object.entries(getSchemaProperties(tool.schema));
  if (propertyEntries.length > 0) tokens += 3;
  for (const [propertyName, property] of propertyEntries) tokens += estimateOpenAIPropertyTokens(propertyName, property);
  return tokens;
}

function estimateOpenAIPropertyTokens(propertyName: string, property: unknown): number {
  const propInit = 3;
  const propKey = 3;
  const enumInit = -3;
  const enumItem = 3;

  let tokens = propKey;
  const enumValues = schemaPropertyEnum(property);
  if (enumValues.length > 0) {
    tokens += enumInit;
    for (const enumValue of enumValues) tokens += enumItem + estimateOpenAIToolTextTokens(String(enumValue));
  }
  tokens += estimateOpenAIToolTextTokens(`${propertyName}:${schemaPropertyType(property)}:${schemaPropertyDescription(property)}`);

  const nestedEntries = Object.entries(getSchemaProperties(property));
  if (nestedEntries.length > 0) {
    tokens += propInit;
    for (const [nestedName, nestedProperty] of nestedEntries) tokens += estimateOpenAIPropertyTokens(nestedName, nestedProperty);
  }

  const itemEntries = Object.entries(schemaArrayItemProperties(property));
  if (itemEntries.length > 0) {
    tokens += propInit;
    for (const [itemName, itemProperty] of itemEntries) tokens += estimateOpenAIPropertyTokens(itemName, itemProperty);
  }

  return tokens;
}

function estimateOpenAIFunctionToolTokens(tools: ToolSummary[]): number {
  // OpenAI's public token-counting docs say exact tool counts need the Responses
  // input-token endpoint. For no-API-call startup estimates, use the older
  // cookbook/tiktoken-style schema-summary formula: model-specific constants plus
  // name/description/property summaries, not raw schema JSON. Current public
  // tiktoken maps GPT-5 and GPT-4o families to o200k_base, so use the GPT-4o/GPT-5
  // family constants. A synthetic schema ablation found chars/6.6 over these schema
  // text fragments, plus recursive nested property counting, beats raw schema-char
  // denominators on held-out mixed schemas while remaining dependency-free.
  let tokens = 0;
  for (const tool of tools) tokens += estimateOpenAIToolDefinitionTokens(tool);
  if (tools.length > 0) tokens += 12;
  return tokens;
}

function buildToolDisplayEstimate(tool: ToolSummary, heuristic: ResolvedHeuristic): ToolDisplayEstimate {
  const shape = heuristic.toolNumerator;
  const chars = safeMinifiedJson(toolPayloadForShape(tool, shape)).length;
  if (shape === "openai-cookbook") {
    return { tokens: estimateOpenAIToolDefinitionTokens(tool), chars };
  }
  return { tokens: estimateCharsAsTokens(chars, heuristic.toolDenominator), chars };
}

function buildToolsSection(pi: ExtensionAPI, heuristic: ResolvedHeuristic): { section?: PrefixSection; tools: ToolSummary[]; allTools: ToolSummary[] } {
  const activeNames = new Set(pi.getActiveTools());
  const toolInfos = pi.getAllTools();
  const allTools = toolInfos.map(summarizeTool);
  const tools = toolInfos.filter((tool) => activeNames.has(tool.name)).map(summarizeTool);
  const inactiveTools = allTools
    .filter((tool) => !activeNames.has(tool.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (tools.length === 0) return { tools, allTools };

  const numerator = buildToolNumerator(tools, heuristic);
  const denominator = heuristic.toolDenominator;
  const effectiveTokens = numerator.tokens ?? estimateCharsAsTokens(numerator.chars, denominator);
  const toolEstimates = tools.map((tool) => ({ tool, estimate: buildToolDisplayEstimate(tool, heuristic) }));
  const sortedEstimates = [...toolEstimates].sort((a, b) => b.estimate.tokens - a.estimate.tokens || a.tool.name.localeCompare(b.tool.name));
  const compactToolRows: ScanRow[] = [
    ...sortedEstimates.map(({ tool, estimate }) => ({
      name: tool.name,
      tokens: estimate.tokens,
      desc: tool.description,
      kind: "tool" as const,
    })),
    ...inactiveTools.map((tool) => ({
      name: tool.name,
      desc: `(inactive) ${tool.description}`,
      inactive: true,
      kind: "tool" as const,
    })),
  ];
  return {
    tools,
    allTools,
    section: {
      id: "tools",
      title: `Tools (${tools.length}/${toolInfos.length} active)`,
      content: numerator.content,
      effectiveTokens,
      rawChars: numerator.chars,
      denominator,
      compactRows: compactToolRows,
    },
  };
}

function countTextContent(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, block) => {
    if (!block || typeof block !== "object") return sum;
    const typed = block as { type?: string; text?: string; data?: string; mimeType?: string };
    if (typed.type === "text") return sum + (typed.text ?? "").length;
    if (typed.type === "image") return sum + `[image:${typed.mimeType ?? "unknown"}:${typed.data?.length ?? 0} chars]`.length;
    return sum;
  }, 0);
}

function countToolCallContent(block: unknown): number {
  if (!block || typeof block !== "object") return 0;
  const toolCall = block as { id?: string; name?: string; arguments?: unknown };
  return safeJson({ id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments }).length;
}

function countReasoningPayload(value: unknown): number {
  if (!value) return 0;
  if (typeof value !== "string") return safeJson(value).length;
  try {
    return safeJson(JSON.parse(value)).length;
  } catch {
    return value.length;
  }
}

function buildSessionBreakdown(sessionManager?: SessionSource): SessionBreakdown | undefined {
  if (!sessionManager) return undefined;
  // Session entries are arbitrary historical content; a malformed session should cost
  // the session rows, not the whole panel.
  try {
    const { messages } = buildSessionContext(sessionManager.getEntries(), sessionManager.getLeafId());
    if (messages.length === 0) return undefined;

    const breakdown: SessionBreakdown = {
      thinkingChars: 0,
      toolOutputChars: 0,
      messageChars: 0,
      messageCount: messages.length,
    };

    for (const message of convertToLlm(messages)) {
      if (message.role === "toolResult") {
        breakdown.toolOutputChars += countTextContent(message.content);
        continue;
      }
      if (message.role === "assistant") {
        for (const block of message.content) {
          if (block.type === "thinking") {
            // OpenAI/Codex sends encrypted reasoning items back as context when
            // a signature is present; the visible thinking summary itself is not
            // replayed. For providers without signatures, fall back to text.
            breakdown.thinkingChars += block.thinkingSignature
              ? countReasoningPayload(block.thinkingSignature)
              : (block.thinking ?? "").length;
          } else if (block.type === "toolCall") {
            breakdown.messageChars += countToolCallContent(block);
          } else {
            breakdown.messageChars += countTextContent([block]);
          }
        }
        continue;
      }
      breakdown.messageChars += countTextContent(message.content);
    }

    return breakdown;
  } catch {
    return undefined;
  }
}

function sessionChars(session: SessionBreakdown): number {
  return session.thinkingChars + session.toolOutputChars + session.messageChars;
}

// May throw while Pi is wiring a resumed session. The modal renderer catches this
// and recovers on the next render.
function buildSnapshot(
  pi: ExtensionAPI,
  getSystemPrompt: () => string,
  sessionManager?: SessionSource,
  getContextUsage?: () => ContextUsage | undefined,
  getModel?: () => ModelSummary | undefined,
  config: ContextimateConfig = {},
): PrefixSnapshot {
  const systemPrompt = getSystemPrompt();
  const model = getModel?.();
  const heuristic = resolveHeuristic(model, config);
  const textDenominator = heuristic.textDenominator;
  const promptRemainder = getPromptRemainder(systemPrompt);
  const { section: toolsSection, tools, allTools } = buildToolsSection(pi, heuristic);

  const sections: PrefixSection[] = [
    {
      id: "system", // id is config/signature API — stays "system" even though the title changed
      title: "Runtime system prompt",
      content: promptRemainder,
      denominator: textDenominator,
      selectable: true,
    },
    ...parseContextSections(systemPrompt, textDenominator),
  ];

  const { section: skillsSection, skills } = buildSkillsSection(systemPrompt, textDenominator);
  if (skillsSection) sections.push(skillsSection);
  if (toolsSection) sections.push(toolsSection);

  const session = buildSessionBreakdown(sessionManager);
  const contextUsage = getContextUsage?.();

  const signature = [
    systemPrompt.length,
    model ? `${model.provider}:${model.id}:${model.api}` : "no-model",
    `${heuristic.label}:${heuristic.textDenominator}:${heuristic.sessionDenominator}:${heuristic.toolDenominator}:${heuristic.toolNumerator}`,
    JSON.stringify(config),
    pi.getActiveTools().join(","),
    pi.getAllTools().map((tool) => `${tool.name}:${tool.description.length}`).join(","),
    session ? `${session.thinkingChars}:${session.toolOutputChars}:${session.messageChars}:${session.messageCount}` : "no-session",
    contextUsage ? `${contextUsage.tokens}:${contextUsage.contextWindow}:${contextUsage.percent}` : "no-usage",
  ].join("|");

  return { signature, sections, tools, allTools, skills, heuristic, model, session, contextUsage };
}

function sectionTokens(section: PrefixSection): number {
  return section.effectiveTokens ?? estimateCharsAsTokens(section.content.length, section.denominator);
}

function sectionChars(section: PrefixSection): number {
  return section.rawChars ?? section.content.length;
}

function totalTokens(snapshot: PrefixSnapshot): number {
  return snapshot.sections.reduce((sum, section) => sum + sectionTokens(section), 0);
}

function totalChars(snapshot: PrefixSnapshot): number {
  return snapshot.sections.reduce((sum, section) => sum + sectionChars(section), 0);
}

function padLabel(label: string, width = 42): string {
  // Overlong labels truncate rather than overflow: the token column is a column, and a
  // single 40-char title must not shift it (the … keeps the loss visible).
  const fitted = label.length >= width ? `${label.slice(0, Math.max(0, width - 2))}${ELLIPSIS}` : label;
  return fitted.padEnd(width, " ");
}

// Methodology is stated here, once, in the dim hint line (design language §5) — data
// rows carry only raw sizes. When the session or tool method deviates from the text
// ratio, say so here (tool tokens may come from the OpenAI formula or a different
// denominator).
function methodologyHint(heuristic: ResolvedHeuristic): string {
  const sessionPart = heuristic.sessionDenominator !== heuristic.textDenominator
    ? `${SEP}session ${ratioDetail(heuristic.sessionDenominator)}`
    : "";
  const toolsPart = heuristic.toolNumerator === "openai-cookbook"
    ? `${SEP}tools: OpenAI formula`
    : heuristic.toolDenominator !== heuristic.textDenominator
      ? `${SEP}tools ${ratioDetail(heuristic.toolDenominator)}`
      : "";
  return `counts ch ${ratioDetail(heuristic.textDenominator)}${sessionPart}${toolsPart} (${heuristic.label})`;
}

function renderHeader(snapshot: PrefixSnapshot, mode: ViewMode, theme: Theme): string[] {
  const ctrlO = keyText("app.tools.expand") || "Ctrl+O";
  return panelHeader(theme, "Contextimate", {
    modes: VIEW_MODES,
    active: mode,
    hint: `${ctrlO}: cycle view${SEP}model ${modelLabel(snapshot.model)}${SEP}${methodologyHint(snapshot.heuristic)}`,
  });
}

// One renderer for every label/tokens/detail row — section rows, session rows, and
// totals all flow through here, so alignment and grammar can never diverge.
type MetricRow = {
  label: string;
  tokens: number;
  /** pi-reported numbers render without the ~ estimate marker. */
  exact?: boolean;
  /** total rows: accent + bold. */
  emphasis?: boolean;
  /** dim suffix, parens included, e.g. "(1.2k ch)" or "(residual)". */
  detail?: string;
  /** summary section rows open with the family ▸ glyph (design language §1). */
  section?: boolean;
};

function renderMetricRow(row: MetricRow, theme: Theme, layout?: TokenLabelLayout): string {
  const tokenText = `${row.exact ? exactTokenLabel(row.tokens, layout) : estimatedTokenLabel(row.tokens, layout)} tokens`;
  if (row.emphasis) {
    return `  ${accent(theme, theme.bold(`${padLabel(row.label)}${tokenText}`))}${row.detail ? ` ${theme.fg("dim", row.detail)}` : ""}`;
  }
  const lead = row.section ? `${accent(theme, GLYPH.section)} ` : "";
  const labelWidth = row.section ? 40 : 42; // glyph + space keep the token column aligned
  return `  ${lead}${theme.fg("muted", padLabel(row.label, labelWidth))}${theme.fg("dim", `${tokenText}${row.detail ? ` ${row.detail}` : ""}`)}`;
}

type SessionEstimate = {
  totalTokens: number;
  totalSource: "pi" | "heuristic";
  toolOutputTokens: number;
  messageTokens: number;
  otherTokens: number;
  denominator: number;
};

function buildSessionEstimate(snapshot: PrefixSnapshot): SessionEstimate | undefined {
  if (!snapshot.session) return undefined;
  const denominator = snapshot.heuristic.sessionDenominator;
  const toolOutputTokens = estimateCharsAsTokens(snapshot.session.toolOutputChars, denominator);
  const messageTokens = estimateCharsAsTokens(snapshot.session.messageChars, denominator);
  const heuristicTotal = estimateCharsAsTokens(sessionChars(snapshot.session), denominator);
  const harnessTokens = totalTokens(snapshot);
  const piSessionTokens = snapshot.contextUsage?.tokens === null || snapshot.contextUsage?.tokens === undefined
    ? undefined
    : Math.max(0, Math.round(snapshot.contextUsage.tokens - harnessTokens));
  const totalTokensValue = piSessionTokens ?? heuristicTotal;
  const otherTokens = Math.max(0, Math.round(totalTokensValue - toolOutputTokens - messageTokens));
  return {
    totalTokens: totalTokensValue,
    totalSource: piSessionTokens === undefined ? "heuristic" : "pi",
    toolOutputTokens,
    messageTokens,
    otherTokens,
    denominator,
  };
}

// --- proportion (design language §8): "of what" — shares of the context window --------

/**
 * Integer percent of the context window; `<1%` rather than a dishonest `0%`. Shares
 * derived from estimated token counts carry the ~ marker — a wrong harness estimate
 * must not masquerade as an exact share (only Total request is pi-exact).
 */
function ctxShareLabel(tokens: number, usage: ContextUsage | undefined, options: { estimate?: boolean } = {}): string | undefined {
  if (!usage || usage.tokens === null || usage.contextWindow <= 0) return undefined;
  const percent = (tokens / usage.contextWindow) * 100;
  if (!Number.isFinite(percent) || percent < 0) return undefined;
  const rounded = Math.round(percent);
  if (rounded === 0 && tokens > 0) return "<1% ctx";
  return `${options.estimate ? "~" : ""}${rounded}% ctx`;
}

// The window is a budget label, not a measurement: 200k, not 200.0k.
function contextWindowLabel(tokens: number): string {
  return compactCount(tokens).replace(/\.0(k|M)$/, "$1");
}

function harnessDetail(snapshot: PrefixSnapshot): string {
  const share = ctxShareLabel(totalTokens(snapshot), snapshot.contextUsage, { estimate: true });
  return countDetail(totalChars(snapshot), share ? `· ${share}` : undefined);
}

// One stacked bar under Total request: the carried part (harness + session) in accent,
// free window dim — the half-second "how full am I?" answer.
function renderContextBar(snapshot: PrefixSnapshot, estimate: SessionEstimate, theme: Theme, width: number): string[] {
  const usage = snapshot.contextUsage;
  if (!usage || usage.tokens === null || usage.contextWindow <= 0) return [];
  const free = Math.max(0, usage.contextWindow - usage.tokens);
  const legend =
    `harness ~${compactCount(totalTokens(snapshot))}${SEP}session ~${compactCount(estimate.totalTokens)}${SEP}free ${compactCount(free)}`;
  const room = Math.max(0, width - 4 - legend.length - 2);
  const sameLine = room >= 12;
  const barWidth = Math.min(28, Math.max(12, sameLine ? room : width - 4));
  const carried = Math.min(1, Math.max(0, usage.tokens / usage.contextWindow));
  const filled = Math.min(barWidth, Math.max(usage.tokens > 0 ? 1 : 0, Math.round(carried * barWidth)));
  const bar = `${accent(theme, "█".repeat(filled))}${theme.fg("dim", "▒".repeat(barWidth - filled))}`;
  return sameLine
    ? [`  ${bar}  ${theme.fg("dim", legend)}`]
    : [`  ${bar}`, `  ${theme.fg("dim", legend)}`];
}

function renderSessionRows(snapshot: PrefixSnapshot, theme: Theme, width: number, layout?: TokenLabelLayout): string[] {
  const estimate = buildSessionEstimate(snapshot);
  if (!snapshot.session || !estimate) return [];
  const sessionShare = ctxShareLabel(estimate.totalTokens, snapshot.contextUsage, { estimate: true });
  const provenance = estimate.totalSource === "pi" ? "Pi current - harness" : "heuristic fallback";
  const rows = [
    "",
    renderMetricRow({ label: "Tool outputs", tokens: estimate.toolOutputTokens, detail: countDetail(snapshot.session.toolOutputChars) }, theme, layout),
    renderMetricRow({ label: "Messages", tokens: estimate.messageTokens, detail: countDetail(snapshot.session.messageChars) }, theme, layout),
    renderMetricRow({ label: "Other / reasoning", tokens: estimate.otherTokens, detail: "(residual)" }, theme, layout),
    renderMetricRow({
      label: "Total session",
      tokens: estimate.totalTokens,
      emphasis: true,
      detail: sessionShare ? `(${sessionShare} · ${provenance})` : `(${provenance})`,
    }, theme, layout),
  ];
  const usage = snapshot.contextUsage;
  if (usage && usage.tokens !== null) {
    const percent = formatPercent(usage.percent);
    const window = usage.contextWindow > 0 ? contextWindowLabel(usage.contextWindow) : undefined;
    rows.push(renderMetricRow({
      label: "Total request",
      tokens: usage.tokens,
      exact: true,
      emphasis: true,
      detail: percent && window ? `(${percent} / ${window} ctx)` : "(Pi usage)",
    }, theme, layout));
    rows.push(...renderContextBar(snapshot, estimate, theme, width));
  }
  return rows;
}

function summaryTokenLayout(snapshot: PrefixSnapshot): TokenLabelLayout {
  const values = [...snapshot.sections.map(sectionTokens), totalTokens(snapshot)];
  const sessionEstimate = buildSessionEstimate(snapshot);
  if (sessionEstimate) values.push(
    sessionEstimate.totalTokens,
    sessionEstimate.toolOutputTokens,
    sessionEstimate.messageTokens,
    sessionEstimate.otherTokens,
  );
  if (typeof snapshot.contextUsage?.tokens === "number") values.push(snapshot.contextUsage.tokens);
  return tokenLabelLayout(values);
}

function renderSummary(snapshot: PrefixSnapshot, theme: Theme, width = 80): string[] {
  const lines = renderHeader(snapshot, "summary", theme);
  const layout = summaryTokenLayout(snapshot);
  lines.push("");
  for (const section of snapshot.sections) {
    lines.push(renderMetricRow({
      label: section.title,
      tokens: sectionTokens(section),
      detail: countDetail(sectionChars(section)),
      section: true,
    }, theme, layout));
  }
  lines.push(
    renderMetricRow({ label: "Total harness", tokens: totalTokens(snapshot), emphasis: true, detail: harnessDetail(snapshot) }, theme, layout),
    ...renderSessionRows(snapshot, theme, width, layout),
  );
  lines.push(""); // panel tail spacer (design language §8)
  return lines;
}

type CompactLayout = { labelWidth: number; tokenLayout: TokenLabelLayout };

function compactLabel(label: string, width: number): string {
  if (label.length > width) return `${label.slice(0, Math.max(0, width - 1))}…`;
  return label.padEnd(width, " ");
}

function numericRowTokens(rows: ScanRow[]): number[] {
  return rows.flatMap((row) => typeof row.tokens === "number" ? [row.tokens] : []);
}

function compactLayout(snapshot: PrefixSnapshot): CompactLayout {
  const rows = snapshot.sections.flatMap((section) => section.compactRows ?? []);
  const labels = [
    ...snapshot.sections.map((section) => section.title),
    ...rows.map((row) => row.name),
    "Total harness",
  ];
  const labelWidth = Math.min(26, Math.max(0, ...labels.map((label) => label.length)));
  const tokenLayout = tokenLabelLayout([
    ...snapshot.sections.map(sectionTokens),
    ...numericRowTokens(rows),
    totalTokens(snapshot),
  ]);
  return { labelWidth, tokenLayout };
}

function inactiveTokenField(layout: TokenLabelLayout): string {
  return "-".padStart(Math.max(1, layout.unitWidth + 1)).padEnd(Math.max(layout.fieldWidth, layout.unitWidth + 1, 1), " ");
}

function selectionKey(selection: CompactSelection): string {
  return `${selection.kind}:${selection.name}`;
}

function compactSelections(snapshot: PrefixSnapshot): CompactSelection[] {
  return snapshot.sections.flatMap((section) => [
    ...(section.selectable ? [{ kind: "section" as const, name: section.id }] : []),
    ...(section.compactRows ?? [])
      .filter((row): row is ScanRow & { kind: SelectableKind } => row.kind !== undefined)
      .map((row) => ({ kind: row.kind, name: row.name })),
  ]);
}

function renderScanRows(
  rows: ScanRow[],
  theme: Theme,
  width: number,
  layout?: CompactLayout,
  selectedKey?: string,
): string[] {
  const labelWidth = layout?.labelWidth ?? Math.min(26, Math.max(...rows.map((row) => row.name.length)));
  const tokenLayout = layout?.tokenLayout ?? tokenLabelLayout(numericRowTokens(rows));
  const tokenWidth = Math.max(tokenLayout.fieldWidth, tokenLayout.unitWidth + 1, 1);
  const effectiveTokenLayout = { ...tokenLayout, fieldWidth: tokenWidth };
  const descWidth = Math.max(24, width - (4 + labelWidth + 2 + tokenWidth + 2));
  return rows.map((row) => {
    const selected = row.kind !== undefined && selectionKey({ kind: row.kind, name: row.name }) === selectedKey;
    const prefix = selected ? `  ${accent(theme, "›")} ` : "    ";
    const name = compactLabel(row.name, labelWidth);
    const desc = row.desc ? singleLine(row.desc, descWidth) : "";
    const token = typeof row.tokens === "number"
      ? estimatedTokenField(row.tokens, effectiveTokenLayout)
      : inactiveTokenField(effectiveTokenLayout);
    if (row.inactive) {
      return theme.fg("dim", `${prefix}${name}  ${token}${desc ? `  ${desc}` : ""}`);
    }
    return `${prefix}${theme.fg("text", selected ? theme.bold(name) : name)}  ${accent(theme, token)}${desc ? `  ${theme.fg("dim", desc)}` : ""}`;
  });
}

function renderCompactTotalRow(snapshot: PrefixSnapshot, theme: Theme, layout: CompactLayout): string {
  const label = compactLabel("Total harness", layout.labelWidth + 2);
  const token = `${estimatedTokenLabel(totalTokens(snapshot), layout.tokenLayout)} tokens`;
  return `  ${accent(theme, theme.bold(`${label}  ${token}`))} ${theme.fg("dim", harnessDetail(snapshot))}`;
}

function renderCompact(snapshot: PrefixSnapshot, theme: Theme, width: number, selected?: CompactSelection): string[] {
  const lines = renderHeader(snapshot, "compact", theme);
  const layout = compactLayout(snapshot);
  for (const section of snapshot.sections) {
    const title = compactLabel(section.title, layout.labelWidth);
    const counts = `${estimatedTokenLabel(sectionTokens(section), layout.tokenLayout)} tokens ${countDetail(sectionChars(section))}`;
    const sectionSelected = selected?.kind === "section" && selected.name === section.id;
    const sectionGlyph = sectionSelected ? "›" : GLYPH.section;
    lines.push("", `  ${accent(theme, sectionGlyph)} ${theme.bold(title)}  ${theme.fg("dim", counts)}`);
    if (section.compactRows && section.compactRows.length > 0) {
      lines.push(...renderScanRows(section.compactRows, theme, width, layout, selected ? selectionKey(selected) : undefined));
    }
  }
  const sessionTokenLayout = summaryTokenLayout(snapshot);
  lines.push("", renderCompactTotalRow(snapshot, theme, layout), ...renderSessionRows(snapshot, theme, width, sessionTokenLayout));
  lines.push(""); // panel tail spacer (design language §8)
  return lines;
}

function wrapLines(lines: string[], width: number): string[] {
  const maxWidth = Math.max(24, width);
  const out: string[] = [];
  for (const rawLine of lines) {
    if (rawLine.length === 0) {
      out.push("");
      continue;
    }
    const wrapped = wrapTextWithAnsi(rawLine, maxWidth);
    if (wrapped.length === 0) out.push("");
    else out.push(...wrapped.map((line) => truncateToWidth(line, maxWidth, "…")));
  }
  return out;
}

class ContextimateComponent implements Component {
  private cachedSignature?: string;
  private cachedMode?: ViewMode;
  private cachedWidth?: number;
  private cachedSelection?: string;
  private cachedLines?: string[];
  private selectedIndex = 0;

  // No TS parameter properties: keep the source compatible with Node's strip-only
  // type stripping so the zero-dependency test harness can import this file directly.
  private readonly snapshot: () => PrefixSnapshot;
  private readonly getTheme: () => Theme;
  private mode: ViewMode;

  constructor(snapshot: () => PrefixSnapshot, getTheme: () => Theme, mode: ViewMode) {
    this.snapshot = snapshot;
    this.getTheme = getTheme;
    this.mode = mode;
  }

  getMode(): ViewMode {
    return this.mode;
  }

  cycleMode(direction: 1 | -1 = 1): ViewMode {
    const currentIndex = VIEW_MODES.indexOf(this.mode);
    this.mode = VIEW_MODES[(currentIndex + VIEW_MODES.length + direction) % VIEW_MODES.length] ?? DEFAULT_MODE;
    this.invalidate();
    return this.mode;
  }

  getSelection(): CompactSelection | undefined {
    return compactSelections(this.snapshot())[this.selectedIndex];
  }

  moveSelection(delta: number): void {
    const count = compactSelections(this.snapshot()).length;
    if (count === 0) return;
    this.selectedIndex = (this.selectedIndex + count + delta % count) % count;
    this.invalidate();
  }

  render(width: number): string[] {
    try {
      const snapshot = this.snapshot();
      const selection = this.mode === "compact" ? this.getSelection() : undefined;
      const selectedKey = selection ? selectionKey(selection) : undefined;
      if (
        this.cachedLines &&
        this.cachedSignature === snapshot.signature &&
        this.cachedMode === this.mode &&
        this.cachedWidth === width &&
        this.cachedSelection === selectedKey
      ) {
        return this.cachedLines;
      }

      const theme = this.getTheme();
      const body = this.mode === "summary"
        ? renderSummary(snapshot, theme, width)
        : renderCompact(snapshot, theme, width, selection);

      this.cachedSignature = snapshot.signature;
      this.cachedMode = this.mode;
      this.cachedWidth = width;
      this.cachedSelection = selectedKey;
      this.cachedLines = wrapLines(body, Math.max(20, width));
      return this.cachedLines;
    } catch {
      this.cachedSignature = "contextimate-unavailable";
      this.cachedMode = this.mode;
      this.cachedWidth = width;
      this.cachedLines = wrapLines([
        "",
        `${accent(undefined, "[Contextimate]")} unavailable while Pi finishes resuming this session`,
      ], Math.max(20, width));
      return this.cachedLines;
    }
  }

  invalidate(): void {
    this.cachedSignature = undefined;
    this.cachedMode = undefined;
    this.cachedWidth = undefined;
    this.cachedSelection = undefined;
    this.cachedLines = undefined;
  }
}

type DetailContent = { title: string; text: string };

function buildDetail(snapshot: PrefixSnapshot, selection: CompactSelection): DetailContent | undefined {
  if (selection.kind === "section") {
    const section = snapshot.sections.find((candidate) => candidate.id === selection.name);
    return section ? { title: section.title, text: section.content } : undefined;
  }

  if (selection.kind === "skill") {
    const skill = snapshot.skills.find((candidate) => candidate.name === selection.name);
    if (!skill) return undefined;
    try {
      return { title: `Skill: ${skill.name}`, text: readFileSync(skill.location, "utf8") };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { title: `Skill: ${skill.name}`, text: `Unable to read ${skill.location}\n\n${reason}` };
    }
  }

  const tool = snapshot.allTools.find((candidate) => candidate.name === selection.name);
  if (!tool) return undefined;
  const active = snapshot.tools.some((candidate) => candidate.name === tool.name);
  const guidelines = tool.promptGuidelines.length > 0
    ? tool.promptGuidelines.map((guideline) => `- ${guideline}`).join("\n")
    : "(none)";
  return {
    title: `Tool: ${tool.name}`,
    text: [
      `Status: ${active ? "active" : "inactive"}`,
      `Source: ${tool.source}`,
      "",
      "Description:",
      tool.description,
      "",
      "Prompt guidelines:",
      guidelines,
      "",
      "Input schema:",
      safeJson(tool.schema),
    ].join("\n"),
  };
}

// Test-only surface. Pi loads extensions via `jiti.import(path, { default: true })`,
// so named exports are runtime-inert; this object exists for the repo test suites
// (see docs/testing.md) and is not a stable public API.
export const internals = {
  // system-prompt parsing
  PROJECT_CONTEXT_RE,
  PROJECT_INSTRUCTIONS_RE,
  AVAILABLE_SKILLS_RE,
  SKILL_RE,
  getPromptRemainder,
  parseSkills,
  parseContextSections,
  buildSkillsSection,
  // heuristic resolution
  cleanDenominator,
  resolveHeuristic,
  // provider payload shaping
  toolPayloadForShape,
  aggregateToolPayloadForShape,
  buildToolNumerator,
  buildToolDisplayEstimate,
  // OpenAI cookbook-style formula
  estimateOpenAIToolDefinitionTokens,
  estimateOpenAIFunctionToolTokens,
  // session accounting
  buildSessionEstimate,
  // token label layout
  tokenLabelLayout,
  estimatedTokenLabel,
  estimatedTokenField,
  exactTokenLabel,
  renderMetricRow,
  // proportion (design language §8)
  ctxShareLabel,
  contextWindowLabel,
  methodologyHint,
  // snapshot + renderers
  buildSnapshot,
  totalTokens,
  renderSummary,
  renderCompact,
};

export type {
  PrefixSnapshot,
  PrefixSection,
  ToolSummary,
  ModelSummary,
  ContextimateConfig,
  ResolvedHeuristic,
  SessionBreakdown,
};

export default function piContextimate(pi: ExtensionAPI) {
  pi.registerCommand("contextimate", {
    description: "Show an interactive context usage breakdown (summary or compact)",
    getArgumentCompletions: (prefix) => {
      const matches = VIEW_MODES.filter((mode) => mode.startsWith(prefix.toLowerCase()));
      return matches.length > 0 ? matches.map((mode) => ({ value: mode, label: mode })) : null;
    },
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") return;

      const requested = args.trim().toLowerCase();
      if (requested !== "" && requested !== "summary" && requested !== "compact") {
        ctx.ui.notify("Usage: /contextimate [summary|compact]", "warning");
        return;
      }

      const mode: ViewMode = requested || DEFAULT_MODE;
      const snapshot = buildSnapshot(
        pi,
        () => ctx.getSystemPrompt(),
        ctx.sessionManager,
        () => ctx.getContextUsage(),
        () => toModelSummary(ctx.model),
        loadContextimateConfig(ctx.cwd),
      );

      await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
        const content = new ContextimateComponent(() => snapshot, () => theme, mode);
        let scrollOffset = 0;
        let detail: DetailContent | undefined;

        const component: Component = {
          render: (width) => {
            if (detail) {
              const headerLines = [
                theme.bold(detail.title),
                theme.fg("dim", "Full definition"),
              ];
              const bodyLines = wrapLines(detail.text.split("\n"), width);
              const bodyHeight = Math.max(1, tui.terminal.rows - headerLines.length - 2);
              const maxOffset = Math.max(0, bodyLines.length - bodyHeight);
              scrollOffset = Math.min(scrollOffset, maxOffset);
              const visibleBody = bodyLines.slice(scrollOffset, scrollOffset + bodyHeight);
              const position = maxOffset > 0
                ? `${scrollOffset + 1}-${Math.min(scrollOffset + bodyHeight, bodyLines.length)}/${bodyLines.length}${SEP}`
                : "";
              const footer = theme.fg("dim", `${position}↑/↓/PgUp/PgDn scroll${SEP}esc back${SEP}q close`);
              return [...headerLines, ...visibleBody, truncateToWidth(footer, width, "…")];
            }

            const allLines = content.render(width);
            const headerLines = allLines.slice(0, 2);
            const bodyLines = allLines.slice(2);
            const bodyHeight = Math.max(1, tui.terminal.rows - headerLines.length - 2);
            if (content.getMode() === "compact") {
              const selectedLine = bodyLines.findIndex((line) => line.includes("›"));
              if (selectedLine >= 0) {
                if (selectedLine < scrollOffset) scrollOffset = selectedLine;
                if (selectedLine >= scrollOffset + bodyHeight) scrollOffset = selectedLine - bodyHeight + 1;
              }
            }
            const maxOffset = Math.max(0, bodyLines.length - bodyHeight);
            scrollOffset = Math.min(scrollOffset, maxOffset);
            const visibleBody = bodyLines.slice(scrollOffset, scrollOffset + bodyHeight);
            const position = maxOffset > 0
              ? `${scrollOffset + 1}-${Math.min(scrollOffset + bodyHeight, bodyLines.length)}/${bodyLines.length}${SEP}`
              : "";
            const interaction = content.getMode() === "compact"
              ? `↑/↓ select${SEP}enter inspect`
              : "↑/↓/PgUp/PgDn scroll";
            const footer = theme.fg("dim", `${position}←/→ or tab view${SEP}${interaction}${SEP}q/esc close`);
            return [...headerLines, ...visibleBody, truncateToWidth(footer, width, "…")];
          },
          handleInput: (data) => {
            const pageSize = Math.max(1, tui.terminal.rows - 6);
            if (detail) {
              if (matchesKey(data, "escape")) {
                detail = undefined;
                scrollOffset = 0;
              } else if (data.toLowerCase() === "q" || keybindings.matches(data, "tui.select.cancel")) {
                done();
                return;
              } else if (keybindings.matches(data, "tui.select.up")) {
                scrollOffset = Math.max(0, scrollOffset - 1);
              } else if (keybindings.matches(data, "tui.select.down")) {
                scrollOffset += 1;
              } else if (keybindings.matches(data, "tui.select.pageUp")) {
                scrollOffset = Math.max(0, scrollOffset - pageSize);
              } else if (keybindings.matches(data, "tui.select.pageDown")) {
                scrollOffset += pageSize;
              } else {
                return;
              }
              tui.requestRender();
              return;
            }

            let changed = true;
            if (keybindings.matches(data, "tui.select.cancel") || data.toLowerCase() === "q") {
              done();
              return;
            } else if (
              keybindings.matches(data, "app.tools.expand")
              || keybindings.matches(data, "tui.input.tab")
              || matchesKey(data, "right")
            ) {
              content.cycleMode(1);
              scrollOffset = 0;
            } else if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) {
              content.cycleMode(-1);
              scrollOffset = 0;
            } else if (content.getMode() === "compact" && keybindings.matches(data, "tui.select.confirm")) {
              const selection = content.getSelection();
              detail = selection ? buildDetail(snapshot, selection) : undefined;
              scrollOffset = 0;
            } else if (content.getMode() === "compact" && keybindings.matches(data, "tui.select.up")) {
              content.moveSelection(-1);
            } else if (content.getMode() === "compact" && keybindings.matches(data, "tui.select.down")) {
              content.moveSelection(1);
            } else if (content.getMode() === "compact" && keybindings.matches(data, "tui.select.pageUp")) {
              content.moveSelection(-pageSize);
            } else if (content.getMode() === "compact" && keybindings.matches(data, "tui.select.pageDown")) {
              content.moveSelection(pageSize);
            } else if (keybindings.matches(data, "tui.select.up")) {
              scrollOffset = Math.max(0, scrollOffset - 1);
            } else if (keybindings.matches(data, "tui.select.down")) {
              scrollOffset += 1;
            } else if (keybindings.matches(data, "tui.select.pageUp")) {
              scrollOffset = Math.max(0, scrollOffset - pageSize);
            } else if (keybindings.matches(data, "tui.select.pageDown")) {
              scrollOffset += pageSize;
            } else {
              changed = false;
            }
            if (changed) tui.requestRender();
          },
          invalidate: () => content.invalidate(),
        };
        return component;
      });
    },
  });
}
