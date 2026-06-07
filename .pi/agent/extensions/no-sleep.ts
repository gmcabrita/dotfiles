/**
 * Prevent macOS from sleeping while pi's agent is running.
 *
 * Uses caffeinate(8). Renders current sleep-prevention state in the pi status
 * bar.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MACOS = process.platform === "darwin";

type Scope = "agent" | "session";
type Level = "info" | "warning" | "error";

let caffeinate: ChildProcess | undefined;
let caffeinateReady = false;
let enabled = readBooleanEnv("PI_NO_SLEEP", true);
let scope: Scope = readScopeEnv();
let agentActive = false;
let lastError: string | undefined;
let thinkingLevel = "off";

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return !/^(0|false|no|off)$/i.test(value);
}

function readScopeEnv(): Scope {
  return /^session$/i.test(process.env.PI_NO_SLEEP_SCOPE ?? "") ? "session" : "agent";
}

function caffeinateArgs(): string[] {
  const args = ["-i", "-s"];

  // By default, allow the display to sleep. Set PI_NO_SLEEP_DISPLAY=1 to keep
  // the screen awake too.
  if (readBooleanEnv("PI_NO_SLEEP_DISPLAY", false)) {
    args.push("-d");
  }

  // Tie the assertion to the pi process so a hard crash won't leave caffeinate
  // running forever.
  args.push("-w", String(process.pid));
  return args;
}

function notify(ctx: ExtensionContext | undefined, message: string, level: Level = "info"): void {
  if (ctx?.hasUI) {
    ctx.ui.notify(message, level);
  }
}

function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function formatTokens(count: number): string {
  if (count < 1_000) return count.toString();
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
  if (!home) return cwd;

  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    relativeToHome === "" ||
    (relativeToHome !== ".." &&
      !relativeToHome.startsWith(`..${sep}`) &&
      !isAbsolute(relativeToHome));

  if (!isInsideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function updateFooter(ctx: ExtensionContext | undefined): void {
  if (ctx?.mode !== "tui") {
    return;
  }

  ctx.ui.setStatus("no-sleep", undefined);

  if (!caffeinateReady) {
    ctx.ui.setFooter(undefined);
    return;
  }

  ctx.ui.setFooter((tui, theme, footerData) => {
    const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

    return {
      dispose: unsubscribe,
      invalidate() {},
      render(width: number): string[] {
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheRead = 0;
        let totalCacheWrite = 0;
        let totalCost = 0;

        for (const entry of ctx.sessionManager.getEntries()) {
          if (entry.type === "message" && entry.message.role === "assistant") {
            totalInput += entry.message.usage.input;
            totalOutput += entry.message.usage.output;
            totalCacheRead += entry.message.usage.cacheRead;
            totalCacheWrite += entry.message.usage.cacheWrite;
            totalCost += entry.message.usage.cost.total;
          }
        }

        const contextUsage = ctx.getContextUsage();
        const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
        const contextPercentValue = contextUsage?.percent ?? 0;
        const contextPercent =
          contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

        let pwd = formatCwdForFooter(
          ctx.sessionManager.getCwd(),
          process.env.HOME || process.env.USERPROFILE,
        );
        const branch = footerData.getGitBranch();
        if (branch) {
          pwd = `${pwd} (${branch})`;
        }

        const sessionName = ctx.sessionManager.getSessionName();
        if (sessionName) {
          pwd = `${pwd} • ${sessionName}`;
        }

        const statsParts: string[] = [];
        if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
        if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
        if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
        if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

        const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
        if (totalCost || usingSubscription) {
          statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
        }

        const contextPercentDisplay =
          contextPercent === "?"
            ? `?/${formatTokens(contextWindow)} (auto)`
            : `${contextPercent}%/${formatTokens(contextWindow)} (auto)`;
        if (contextPercentValue > 90) {
          statsParts.push(theme.fg("error", contextPercentDisplay));
        } else if (contextPercentValue > 70) {
          statsParts.push(theme.fg("warning", contextPercentDisplay));
        } else {
          statsParts.push(contextPercentDisplay);
        }
        statsParts.push("☕");

        let statsLeft = statsParts.join(" ");
        let statsLeftWidth = visibleWidth(statsLeft);
        if (statsLeftWidth > width) {
          statsLeft = truncateToWidth(statsLeft, width, "...");
          statsLeftWidth = visibleWidth(statsLeft);
        }

        const modelName = ctx.model?.id || "no-model";
        let rightSideWithoutProvider = modelName;
        if (ctx.model?.reasoning) {
          rightSideWithoutProvider =
            thinkingLevel === "off"
              ? `${modelName} • thinking off`
              : `${modelName} • ${thinkingLevel}`;
        }

        let rightSide = rightSideWithoutProvider;
        if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
          rightSide = `(${ctx.model.provider}) ${rightSideWithoutProvider}`;
          if (statsLeftWidth + 2 + visibleWidth(rightSide) > width) {
            rightSide = rightSideWithoutProvider;
          }
        }

        const rightSideWidth = visibleWidth(rightSide);
        const totalNeeded = statsLeftWidth + 2 + rightSideWidth;
        let statsLine: string;
        if (totalNeeded <= width) {
          const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
          statsLine = statsLeft + padding + rightSide;
        } else {
          const availableForRight = width - statsLeftWidth - 2;
          if (availableForRight > 0) {
            const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
            const truncatedRightWidth = visibleWidth(truncatedRight);
            const padding = " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth));
            statsLine = statsLeft + padding + truncatedRight;
          } else {
            statsLine = statsLeft;
          }
        }

        const dimStatsLeft = theme.fg("dim", statsLeft);
        const dimRemainder = theme.fg("dim", statsLine.slice(statsLeft.length));
        const lines = [
          truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")),
          dimStatsLeft + dimRemainder,
        ];

        const extensionStatuses = footerData.getExtensionStatuses();
        if (extensionStatuses.size > 0) {
          const sortedStatuses = Array.from(extensionStatuses.entries())
            .filter(([key]) => key !== "no-sleep")
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, text]) => sanitizeStatusText(text))
            .filter((text) => text !== "");
          if (sortedStatuses.length > 0) {
            lines.push(truncateToWidth(sortedStatuses.join(" "), width, theme.fg("dim", "...")));
          }
        }

        return lines;
      },
    };
  });
}

function start(ctx?: ExtensionContext): void {
  if (!enabled || !MACOS || caffeinate) {
    updateFooter(ctx);
    return;
  }

  lastError = undefined;
  caffeinateReady = false;
  const child = spawn("caffeinate", caffeinateArgs(), { stdio: "ignore" });
  child.unref();
  caffeinate = child;

  child.once("spawn", () => {
    if (caffeinate === child) {
      caffeinateReady = true;
      updateFooter(ctx);
    }
  });

  child.once("error", (error) => {
    if (caffeinate !== child) {
      return;
    }
    caffeinate = undefined;
    caffeinateReady = false;
    lastError = error.message;
    updateFooter(ctx);
    notify(ctx, `No Sleep: failed to caffeinate: ${error.message}`, "error");
  });

  child.once("exit", (code, signal) => {
    if (caffeinate !== child) {
      return;
    }
    caffeinate = undefined;
    caffeinateReady = false;
    updateFooter(ctx);

    if (code && code !== 0) {
      lastError = `caffeinate exited with code ${code}`;
      notify(ctx, `No Sleep: caffeinate stopped unexpectedly (${lastError}).`, "warning");
    } else if (signal) {
      lastError = `caffeinate exited after signal ${signal}`;
      notify(ctx, `No Sleep: caffeinate stopped unexpectedly (${lastError}).`, "warning");
    }
  });
}

function stop(ctx?: ExtensionContext): void {
  const child = caffeinate;
  caffeinate = undefined;
  caffeinateReady = false;
  updateFooter(ctx);

  if (!child) {
    return;
  }

  if (child.exitCode === null && !child.killed) {
    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 1_000);
    timer.unref?.();
  }
}

function reconcile(ctx?: ExtensionContext): void {
  if (!enabled) {
    stop(ctx);
    return;
  }

  if (scope === "session" || agentActive) {
    start(ctx);
  } else {
    stop(ctx);
  }
}

function describeState(): string {
  if (!MACOS) {
    return "No Sleep is inactive: caffeinate is only available on macOS.";
  }

  const state = caffeinateReady ? `active (pid ${caffeinate?.pid ?? "unknown"})` : "idle";
  const display = readBooleanEnv("PI_NO_SLEEP_DISPLAY", false) ? "yes" : "no";
  return [
    `No Sleep is ${enabled ? "enabled" : "disabled"}.`,
    `scope: ${scope}`,
    `state: ${state}`,
    `keeps display awake: ${display}`,
    lastError ? `last error: ${lastError}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export default function noSleepExtension(pi: ExtensionAPI) {
  const cleanupOnProcessExit = () => {
    stop(undefined);
  };
  process.once("exit", cleanupOnProcessExit);

  pi.on("session_start", (_event, ctx) => {
    agentActive = false;
    reconcile(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    agentActive = true;
    reconcile(ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    agentActive = false;
    reconcile(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    updateFooter(ctx);
  });

  pi.on("thinking_level_select", (event, ctx) => {
    thinkingLevel = event.level;
    updateFooter(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    agentActive = false;
    stop(ctx);
    process.off("exit", cleanupOnProcessExit);
  });

  pi.registerCommand("no-sleep", {
    description: "Show or change macOS sleep-prevention status",
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();

      if (command === "on" || command === "enable") {
        enabled = true;
        reconcile(ctx);
      } else if (command === "off" || command === "disable") {
        enabled = false;
        reconcile(ctx);
      } else if (command === "toggle") {
        enabled = !enabled;
        reconcile(ctx);
      } else if (command === "agent") {
        scope = "agent";
        reconcile(ctx);
      } else if (command === "session") {
        scope = "session";
        reconcile(ctx);
      } else if (command && command !== "status") {
        notify(ctx, "Usage: /no-sleep [status|on|off|toggle|agent|session]", "warning");
        return;
      }

      updateFooter(ctx);
      notify(ctx, describeState(), lastError ? "warning" : "info");
    },
  });
}
