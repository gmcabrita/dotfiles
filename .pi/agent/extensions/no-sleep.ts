/**
 * Prevent macOS from sleeping while pi's agent is running.
 *
 * Uses caffeinate(8). Shows ☕ inline in pi's native footer while active.
 */

import { FooterComponent, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MACOS = process.platform === "darwin";
const COFFEE = "☕";
const ANSI_PATTERN = /^\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/;
const STRIP_ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

type Scope = "agent" | "session";
type Level = "info" | "warning" | "error";

let caffeinate: ChildProcess | undefined;
let caffeinateReady = false;
let enabled = readBooleanEnv("PI_NO_SLEEP", true);
let scope: Scope = readScopeEnv();
let agentActive = false;
let lastError: string | undefined;
let showCoffeeInFooter = false;
let footerPatched = false;

const originalFooterRender = FooterComponent.prototype.render;

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

function stripAnsi(text: string): string {
  return text.replace(STRIP_ANSI_PATTERN, "");
}

function readAnsiSequence(text: string, index: number): string | undefined {
  const match = ANSI_PATTERN.exec(text.slice(index));
  return match?.[0];
}

function nextCodePoint(text: string, index: number): string | undefined {
  const codePoint = text.codePointAt(index);
  if (codePoint === undefined) {
    return undefined;
  }
  return String.fromCodePoint(codePoint);
}

function rawIndexForVisibleColumn(text: string, targetColumn: number): number {
  let column = 0;
  let index = 0;

  while (index < text.length) {
    if (column >= targetColumn) {
      return index;
    }

    const ansiSequence = readAnsiSequence(text, index);
    if (ansiSequence) {
      index += ansiSequence.length;
      continue;
    }

    const character = nextCodePoint(text, index);
    if (character === undefined) {
      return index;
    }

    column += visibleWidth(character);
    index += character.length;
  }

  return text.length;
}

function dropVisibleColumns(text: string, columns: number): string {
  let remaining = columns;
  let index = 0;
  let prefix = "";

  while (index < text.length) {
    const ansiSequence = readAnsiSequence(text, index);
    if (ansiSequence) {
      prefix += ansiSequence;
      index += ansiSequence.length;
      continue;
    }

    const character = nextCodePoint(text, index);
    if (character === undefined) {
      return prefix;
    }

    const width = visibleWidth(character);
    if (remaining >= width) {
      remaining -= width;
      index += character.length;
      continue;
    }

    return prefix + text.slice(index);
  }

  return prefix;
}

function addCoffeeAfterContext(line: string, width: number): string {
  const visibleLine = stripAnsi(line);
  const separator = / {2,}/.exec(visibleLine);
  const insertionColumn = separator?.index ?? visibleWidth(visibleLine);
  const coffee = ` ${COFFEE}`;
  const coffeeWidth = visibleWidth(coffee);
  const rawInsertionIndex = rawIndexForVisibleColumn(line, insertionColumn);
  const prefix = line.slice(0, rawInsertionIndex);
  const suffix = line.slice(rawInsertionIndex);
  const adjustedSuffix = separator ? dropVisibleColumns(suffix, Math.min(coffeeWidth, separator[0].length)) : suffix;
  const nextLine = prefix + coffee + adjustedSuffix;

  return visibleWidth(nextLine) > width ? truncateToWidth(nextLine, width, "") : nextLine;
}

function patchNativeFooter(): void {
  if (footerPatched) {
    return;
  }

  FooterComponent.prototype.render = function renderWithNoSleep(this: FooterComponent, width: number): string[] {
    const lines = originalFooterRender.call(this, width);
    if (!showCoffeeInFooter || lines.length < 2) {
      return lines;
    }

    return [lines[0], addCoffeeAfterContext(lines[1], width), ...lines.slice(2)];
  };
  footerPatched = true;
}

function restoreNativeFooter(): void {
  if (!footerPatched) {
    return;
  }

  FooterComponent.prototype.render = originalFooterRender;
  footerPatched = false;
}

function updateFooterIndicator(ctx: ExtensionContext | undefined): void {
  showCoffeeInFooter = caffeinateReady;
  if (ctx?.mode === "tui") {
    ctx.ui.setStatus("no-sleep", undefined);
  }
}

function start(ctx?: ExtensionContext): void {
  if (!enabled || !MACOS || caffeinate) {
    updateFooterIndicator(ctx);
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
      updateFooterIndicator(ctx);
    }
  });

  child.once("error", (error) => {
    if (caffeinate !== child) {
      return;
    }
    caffeinate = undefined;
    caffeinateReady = false;
    lastError = error.message;
    updateFooterIndicator(ctx);
    notify(ctx, `No Sleep: failed to caffeinate: ${error.message}`, "error");
  });

  child.once("exit", (code, signal) => {
    if (caffeinate !== child) {
      return;
    }
    caffeinate = undefined;
    caffeinateReady = false;
    updateFooterIndicator(ctx);

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
  updateFooterIndicator(ctx);

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
  patchNativeFooter();

  const cleanupOnProcessExit = () => {
    stop(undefined);
    restoreNativeFooter();
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

  pi.on("session_shutdown", (_event, ctx) => {
    agentActive = false;
    stop(ctx);
    restoreNativeFooter();
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

      updateFooterIndicator(ctx);
      notify(ctx, describeState(), lastError ? "warning" : "info");
    },
  });
}
