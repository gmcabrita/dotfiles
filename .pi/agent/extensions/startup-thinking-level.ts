import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  switch (value) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return true;
    default:
      return false;
  }
}

function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (isRecord(parsed)) return parsed;
  } catch {
    return {};
  }

  return {};
}

function readThinkingLevel(
  settings: Record<string, unknown>,
  key: string,
): ThinkingLevel | undefined {
  const value = settings[key];
  return isThinkingLevel(value) ? value : undefined;
}

function getStartupThinkingLevel(cwd: string): ThinkingLevel | undefined {
  const globalSettings = readSettings(join(getAgentDir(), "settings.json"));
  const projectSettings = readSettings(join(cwd, ".pi", "settings.json"));

  return (
    readThinkingLevel(projectSettings, "startupThinkingLevel") ??
    readThinkingLevel(globalSettings, "startupThinkingLevel") ??
    readThinkingLevel(projectSettings, "defaultThinkingLevel") ??
    readThinkingLevel(globalSettings, "defaultThinkingLevel")
  );
}

export default function startupThinkingLevelExtension(pi: ExtensionAPI) {
  pi.on("session_start", (event, ctx) => {
    if (event.reason !== "startup") return;

    const level = getStartupThinkingLevel(ctx.cwd);
    if (!level || pi.getThinkingLevel() === level) return;

    pi.setThinkingLevel(level);
  });
}
