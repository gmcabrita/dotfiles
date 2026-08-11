import {
  readStoredCredential,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const AUTH_ID = "firecrawl";
const API_KEY_ENV = "FIRECRAWL_API_KEY";
const BRIDGE_STATE_KEY = Symbol.for("gmcabrita.pi.firecrawl-auth");

type BridgeState = {
  injected: boolean;
  lastApiKey?: string;
};

type FirecrawlCredential = {
  type?: unknown;
  key?: unknown;
  keys?: unknown;
  env?: Record<string, unknown>;
};

function bridgeState(): BridgeState {
  const store = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = store[BRIDGE_STATE_KEY] as BridgeState | undefined;
  if (existing) return existing;

  const state = { injected: false };
  store[BRIDGE_STATE_KEY] = state;
  return state;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function uniqueKeys(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const keys = values.map(nonEmpty).filter((value): value is string => value !== undefined);
  return [...new Set(keys)];
}

export function readFirecrawlApiKeys(authPath?: string): string[] {
  const credential = readStoredCredential(AUTH_ID, authPath) as FirecrawlCredential | undefined;
  if (credential?.type !== "api_key") return [];

  const keys = uniqueKeys(credential.keys);
  if (keys.length > 0) return keys;

  const keyArray = uniqueKeys(credential.key);
  if (keyArray.length > 0) return keyArray;

  const apiKey = nonEmpty(credential.env?.[API_KEY_ENV]) ?? nonEmpty(credential.key);
  return apiKey ? [apiKey] : [];
}

export function selectFirecrawlApiKey(
  keys: readonly string[],
  previousKey: string | undefined,
  random: () => number = Math.random,
): string | undefined {
  const candidates = keys.length > 1 ? keys.filter((key) => key !== previousKey) : keys;
  if (candidates.length === 0) return undefined;
  return candidates[Math.floor(random() * candidates.length)];
}

export function applyFirecrawlAuth(
  authPath?: string,
  random: () => number = Math.random,
): void {
  const state = bridgeState();
  const currentApiKey = nonEmpty(process.env[API_KEY_ENV]);

  // Keep shell variables and values from other extensions at highest priority.
  if (currentApiKey && (!state.injected || currentApiKey !== state.lastApiKey)) {
    state.injected = false;
    state.lastApiKey = undefined;
    return;
  }

  const apiKey = selectFirecrawlApiKey(
    readFirecrawlApiKeys(authPath),
    state.lastApiKey,
    random,
  );
  if (apiKey) {
    process.env[API_KEY_ENV] = apiKey;
    state.injected = true;
    state.lastApiKey = apiKey;
    return;
  }

  // A reload after credential removal must not retain the previously injected key.
  if (state.injected && currentApiKey === state.lastApiKey) {
    delete process.env[API_KEY_ENV];
  }
  state.injected = false;
  state.lastApiKey = undefined;
}

export default function firecrawlAuthExtension(_pi: ExtensionAPI): void {
  applyFirecrawlAuth();
}
