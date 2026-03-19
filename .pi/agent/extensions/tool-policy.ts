import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir, isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

type Decision = "allow" | "deny";
type ScopedTool = "all" | "read" | "write" | "edit";
type ProtectedTool = Exclude<ScopedTool, "all">;

type OrderedRule = {
  pattern: string;
  decision: Decision;
  sourceFile: string;
};

type RawRulesByTool = Record<ScopedTool, OrderedRule[]>;
type EffectiveRulesByTool = Record<ProtectedTool, OrderedRule[]>;

type FilePolicyState = { kind: "ok"; rules: RawRulesByTool } | { kind: "error"; message: string };

type EffectivePolicyState =
  | { kind: "ok"; rules: EffectiveRulesByTool }
  | { kind: "error"; message: string };

const SCOPED_TOOLS: ScopedTool[] = ["all", "read", "write", "edit"];
const PROTECTED_TOOLS: ProtectedTool[] = ["read", "write", "edit"];

const fileCache = new Map<string, { mtimeMs: number | null; state: FilePolicyState }>();

function emptyRawRules(): RawRulesByTool {
  return { all: [], read: [], write: [], edit: [] };
}

function emptyEffectiveRules(): EffectiveRulesByTool {
  return { read: [], write: [], edit: [] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function stripAtPrefix(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  const DS_SLASH = "__PI_DOUBLE_STAR_SLASH__";
  const SLASH_DS = "__PI_SLASH_DOUBLE_STAR__";
  const DS = "__PI_DOUBLE_STAR__";

  let source = normalizeSlashes(pattern);

  source = source.replace(/\*\*\//g, DS_SLASH);
  source = source.replace(/\/\*\*/g, SLASH_DS);
  source = source.replace(/\*\*/g, DS);

  source = escapeRegex(source);
  source = source.replace(new RegExp(escapeRegex(DS_SLASH), "g"), "(?:.*\\/)?");
  source = source.replace(new RegExp(escapeRegex(SLASH_DS), "g"), "(?:\\/.*)?");
  source = source.replace(new RegExp(escapeRegex(DS), "g"), ".*");
  source = source.replace(/\\\*/g, "[^/]*");
  source = source.replace(/\\\?/g, "[^/]");

  return new RegExp(`^${source}$`, process.platform === "win32" ? "i" : "");
}

function safeStatMtime(path: string): number | null {
  try {
    if (!existsSync(path)) return null;
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function readPolicyFile(settingsPath: string): FilePolicyState {
  const mtimeMs = safeStatMtime(settingsPath);
  const cached = fileCache.get(settingsPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.state;
  }

  let state: FilePolicyState;

  if (mtimeMs === null) {
    state = { kind: "ok", rules: emptyRawRules() };
    fileCache.set(settingsPath, { mtimeMs, state });
    return state;
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;

    if (!isPlainObject(parsed)) {
      state = {
        kind: "error",
        message: `${settingsPath}: settings file must contain a JSON object`,
      };
      fileCache.set(settingsPath, { mtimeMs, state });
      return state;
    }

    const rawToolPolicy = parsed.toolPolicy;
    if (rawToolPolicy === undefined) {
      state = { kind: "ok", rules: emptyRawRules() };
      fileCache.set(settingsPath, { mtimeMs, state });
      return state;
    }

    if (!isPlainObject(rawToolPolicy)) {
      state = {
        kind: "error",
        message: `${settingsPath}: toolPolicy must be an object`,
      };
      fileCache.set(settingsPath, { mtimeMs, state });
      return state;
    }

    const rules = emptyRawRules();

    for (const tool of SCOPED_TOOLS) {
      const rawRules = rawToolPolicy[tool];
      if (rawRules === undefined) continue;

      if (!isPlainObject(rawRules)) {
        state = {
          kind: "error",
          message: `${settingsPath}: toolPolicy.${tool} must be an object`,
        };
        fileCache.set(settingsPath, { mtimeMs, state });
        return state;
      }

      for (const [pattern, decision] of Object.entries(rawRules)) {
        if (!pattern.trim()) {
          state = {
            kind: "error",
            message: `${settingsPath}: toolPolicy.${tool} contains an empty pattern`,
          };
          fileCache.set(settingsPath, { mtimeMs, state });
          return state;
        }

        if (decision !== "allow" && decision !== "deny") {
          state = {
            kind: "error",
            message: `${settingsPath}: toolPolicy.${tool}.${pattern} must be "allow" or "deny"`,
          };
          fileCache.set(settingsPath, { mtimeMs, state });
          return state;
        }

        rules[tool].push({
          pattern: normalizeSlashes(pattern),
          decision,
          sourceFile: settingsPath,
        });
      }
    }

    state = { kind: "ok", rules };
  } catch (error) {
    state = {
      kind: "error",
      message: `${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  fileCache.set(settingsPath, { mtimeMs, state });
  return state;
}

function loadEffectivePolicy(cwd: string): EffectivePolicyState {
  const globalSettingsPath = join(getAgentDir(), "settings.json");
  const projectSettingsPath = join(cwd, ".pi", "settings.json");

  const globalState = readPolicyFile(globalSettingsPath);
  const projectState = readPolicyFile(projectSettingsPath);

  const errors = [globalState, projectState]
    .filter((state): state is Extract<FilePolicyState, { kind: "error" }> => state.kind === "error")
    .map((state) => state.message);

  if (errors.length > 0) {
    return {
      kind: "error",
      message: `toolPolicy load failed: ${errors.join(" | ")}`,
    };
  }

  const globalRules = globalState.rules;
  const projectRules = projectState.rules;
  const effective = emptyEffectiveRules();

  for (const tool of PROTECTED_TOOLS) {
    effective[tool].push(
      ...globalRules.all,
      ...globalRules[tool],
      ...projectRules.all,
      ...projectRules[tool],
    );
  }

  return { kind: "ok", rules: effective };
}

type PathInfo = {
  absolute: string;
  relative: string | null;
  basename: string;
  display: string;
};

function toPathInfo(cwd: string, rawPath: string): PathInfo {
  const cleaned = stripAtPrefix(rawPath.trim());
  const absolute = normalizeSlashes(resolve(cwd, cleaned));
  const cwdAbsolute = normalizeSlashes(resolve(cwd));

  const cwdPrefix = cwdAbsolute.endsWith("/") ? cwdAbsolute : `${cwdAbsolute}/`;
  const insideCwd = absolute === cwdAbsolute || absolute.startsWith(cwdPrefix);

  const relative = insideCwd
    ? absolute === cwdAbsolute
      ? "."
      : absolute.slice(cwdPrefix.length)
    : null;

  const basename = absolute.includes("/")
    ? absolute.slice(absolute.lastIndexOf("/") + 1)
    : absolute;
  const display = relative ?? absolute;

  return { absolute, relative, basename, display };
}

function matchesPattern(pathInfo: PathInfo, pattern: string): boolean {
  const regex = globToRegExp(pattern);

  if (pattern.includes("/")) {
    return [pathInfo.relative, pathInfo.absolute].some(
      (candidate) => candidate !== null && regex.test(candidate),
    );
  }

  return regex.test(pathInfo.basename);
}

function evaluateRules(
  pathInfo: PathInfo,
  rules: OrderedRule[],
): { decision: Decision; matched?: OrderedRule } {
  let decision: Decision = "allow";
  let matched: OrderedRule | undefined;

  for (const rule of rules) {
    if (matchesPattern(pathInfo, rule.pattern)) {
      decision = rule.decision;
      matched = rule;
    }
  }

  return { decision, matched };
}

function extractPatchPaths(patch: string): string[] {
  const paths = new Set<string>();

  for (const match of patch.matchAll(/^\*\*\* (?:Add|Update|Delete|Rename) File: (.+)$/gm)) {
    const path = match[1]?.trim();
    if (path) paths.add(path);
  }

  // Fallback for git-style unified diff paths.
  if (paths.size === 0) {
    for (const match of patch.matchAll(/^(?:\+\+\+ b\/|--- a\/)(.+)$/gm)) {
      const path = match[1]?.trim();
      if (path && path !== "/dev/null") paths.add(path);
    }
  }

  return [...paths];
}

function extractEditPaths(input: Record<string, unknown>): { paths: string[] } | { error: string } {
  const paths: string[] = [];

  if (typeof input.path === "string") {
    paths.push(input.path);
  }

  if (Array.isArray(input.multi)) {
    for (const item of input.multi) {
      if (!isPlainObject(item) || typeof item.path !== "string") {
        return { error: "edit.multi contains an item without a valid path" };
      }
      paths.push(item.path);
    }
  }

  if (typeof input.patch === "string") {
    const patchPaths = extractPatchPaths(input.patch);
    if (patchPaths.length === 0) {
      return { error: "edit.patch target paths could not be determined safely" };
    }
    paths.push(...patchPaths);
  }

  const uniquePaths = [...new Set(paths.map((path) => stripAtPrefix(path).trim()).filter(Boolean))];

  if (uniquePaths.length === 0) {
    return { error: "edit target paths could not be determined safely" };
  }

  return { paths: uniquePaths };
}

function getToolPaths(
  event: Parameters<ExtensionAPI["on"]>[1] extends (event: infer E, ctx: any) => any ? E : never,
): { tool: ProtectedTool; paths: string[] } | { error: string } | null {
  if (isToolCallEventType("read", event)) {
    if (typeof event.input.path !== "string" || !event.input.path.trim()) {
      return { error: "read path is missing" };
    }
    return { tool: "read", paths: [event.input.path] };
  }

  if (isToolCallEventType("write", event)) {
    if (typeof event.input.path !== "string" || !event.input.path.trim()) {
      return { error: "write path is missing" };
    }
    return { tool: "write", paths: [event.input.path] };
  }

  if (isToolCallEventType("edit", event)) {
    const extracted = extractEditPaths(event.input as Record<string, unknown>);
    if ("error" in extracted) return extracted;
    return { tool: "edit", paths: extracted.paths };
  }

  return null;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", (event, ctx) => {
    const extracted = getToolPaths(event);
    if (!extracted) return;

    if ("error" in extracted) {
      if (ctx.hasUI) {
        ctx.ui.notify(`Blocked ${event.toolName}: ${extracted.error}`, "warning");
      }
      return {
        block: true,
        reason: `Blocked ${event.toolName}: ${extracted.error}`,
      };
    }

    const policy = loadEffectivePolicy(ctx.cwd);
    if (policy.kind === "error") {
      if (ctx.hasUI) {
        ctx.ui.notify(policy.message, "error");
      }
      return {
        block: true,
        reason: policy.message,
      };
    }

    const { tool, paths } = extracted;
    const rules = policy.rules[tool];

    for (const rawPath of paths) {
      const pathInfo = toPathInfo(ctx.cwd, rawPath);
      const result = evaluateRules(pathInfo, rules);

      if (result.decision === "deny") {
        const matchedPattern = result.matched?.pattern ?? "(unknown pattern)";
        const sourceFile = result.matched?.sourceFile ?? "(unknown source)";
        const message = `${tool} blocked for ${pathInfo.display} by rule "${matchedPattern}" in ${sourceFile}`;

        if (ctx.hasUI) {
          ctx.ui.notify(message, "warning");
        }

        return {
          block: true,
          reason: message,
        };
      }
    }
  });
}
