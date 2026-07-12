/**
 * pi-chatgpt-web-adapter — Pi extension entry.
 *
 * Registers `chatgpt-web` as a provider whose models are served by a local
 * OpenAI-compatible daemon (`pi-chatgpt-web serve`). Pi's built-in
 * openai-completions streamer talks to the daemon, so `gpt-5-5-pro` becomes a
 * first-class, switchable model with zero custom streaming code here.
 *
 * Runtime uses only Node builtins; the only pi import is a type (erased at
 * runtime), so this loads regardless of how pi resolves its own packages.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "chatgpt-web";
const DEFAULT_PORT = 1456;

function cacheDir(): string {
  return process.env.PI_CHATGPT_WEB_CACHE_DIR || join(homedir(), ".cache", "pi-chatgpt-web");
}
function runtimeFile(): string {
  return join(cacheDir(), "daemon.json");
}
function port(): number {
  return Number(process.env.PI_CHATGPT_WEB_PORT) || DEFAULT_PORT;
}
function baseUrl(p = port()): string {
  return `http://127.0.0.1:${p}/v1`;
}
function binPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "bin", "pi-chatgpt-web.mjs");
}

interface RuntimeInfo {
  host: string;
  port: number;
  pid: number;
}

function readRuntime(): RuntimeInfo | null {
  try {
    if (!existsSync(runtimeFile())) return null;
    return JSON.parse(readFileSync(runtimeFile(), "utf8")) as RuntimeInfo;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function daemonHealthy(p: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${p}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function spawnDaemon(): void {
  const dir = join(cacheDir(), "log");
  mkdirSync(dir, { recursive: true });
  const out = openSync(join(dir, "serve.log"), "a");
  const err = openSync(join(dir, "serve.err.log"), "a");
  const child = spawn(process.execPath, [binPath(), "serve", "--port", String(port())], {
    detached: true,
    stdio: ["ignore", out, err],
    env: { ...process.env },
  });
  child.unref();
}

async function ensureDaemon(): Promise<boolean> {
  const p = port();
  if (await daemonHealthy(p)) return true;
  const rt = readRuntime();
  if (rt && pidAlive(rt.pid) && (await daemonHealthy(rt.port))) return true;
  spawnDaemon();
  // Give it a moment to bind; non-fatal if not ready yet (first request will retry).
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await daemonHealthy(p)) return true;
  }
  return false;
}

function registerModels(pi: ExtensionAPI): void {
  pi.registerProvider(PROVIDER, {
    baseUrl: baseUrl(),
    apiKey: "pi-chatgpt-web-local",
    api: "openai-completions",
    models: [
      {
        id: "gpt-5-5-pro",
        name: "GPT-5.5 Pro (ChatGPT web)",
        api: "openai-completions",
        baseUrl: baseUrl(),
        reasoning: true,
        // ChatGPT Pro's "extended" mode can take many minutes even for small
        // prompts. Keep Pi's default/high levels usable; make extended an
        // explicit xhigh opt-in.
        thinkingLevelMap: { minimal: "standard", low: "standard", medium: "standard", high: "standard", xhigh: "extended" },
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 272000,
        maxTokens: 128000,
        compat: {
          supportsReasoningEffort: true,
          supportsStore: false,
          supportsUsageInStreaming: false,
          supportsStrictMode: false,
        },
      },
      {
        id: "gpt-5-5-thinking",
        name: "GPT-5.5 Thinking (ChatGPT web)",
        api: "openai-completions",
        baseUrl: baseUrl(),
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 272000,
        maxTokens: 128000,
        compat: { supportsReasoningEffort: true, supportsStore: false, supportsUsageInStreaming: false },
      },
      {
        id: "gpt-5-5",
        name: "GPT-5.5 (ChatGPT web)",
        api: "openai-completions",
        baseUrl: baseUrl(),
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 272000,
        maxTokens: 128000,
        compat: { supportsStore: false, supportsUsageInStreaming: false },
      },
    ],
  });
}

export default function chatgptWebAdapter(pi: ExtensionAPI): void {
  try {
    registerModels(pi);
  } catch (err) {
    // Never block session startup if registration fails.
    process.stderr.write(`[pi-chatgpt-web] registerProvider failed: ${String(err)}\n`);
    return;
  }

  // Lazily ensure the daemon is up; don't block startup.
  void ensureDaemon().catch(() => {});

  try {
    if (typeof pi.registerCommand !== "function") return;
    pi.registerCommand("chatgpt-web-doctor", {
      description: "Show pi-chatgpt-web adapter health (auth, browser, daemon).",
      handler: async () => {
        const up = await daemonHealthy(port());
        const rt = readRuntime();
        const lines = [
          `provider: ${PROVIDER}`,
          `daemon: ${up ? "live" : "down"} @ ${baseUrl()}${rt ? ` (pid ${rt.pid})` : ""}`,
          `cli: ${binPath()}`,
          "run `pi-chatgpt-web doctor` in a shell for auth + browser detail,",
          "or `pi-chatgpt-web auth login` if not yet authenticated.",
        ];
        return { type: "text", text: lines.join("\n") } as never;
      },
    } as never);
  } catch (err) {
    process.stderr.write(`[pi-chatgpt-web] registerCommand skipped: ${String(err)}\n`);
  }
}
