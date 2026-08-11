import {
  readStoredCredential,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const AUTH_ID = "firecrawl";
const API_KEY_ENV = "FIRECRAWL_API_KEY";
const BRIDGE_STATE_KEY = Symbol.for("gmcabrita.pi.firecrawl-auth");

type BridgeState = { injected: boolean };

function bridgeState(): BridgeState {
  const store = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = store[BRIDGE_STATE_KEY] as BridgeState | undefined;
  if (existing) return existing;

  const state = { injected: false };
  store[BRIDGE_STATE_KEY] = state;
  return state;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

export function readFirecrawlApiKey(authPath?: string): string | undefined {
  const credential = readStoredCredential(AUTH_ID, authPath);
  if (credential?.type !== "api_key") return undefined;

  return nonEmpty(credential.env?.[API_KEY_ENV]) ?? nonEmpty(credential.key);
}

export function applyFirecrawlAuth(authPath?: string): void {
  const state = bridgeState();
  const apiKey = readFirecrawlApiKey(authPath);

  // Keep pi-firecrawl's documented shell variable as the highest-priority source.
  if (apiKey) {
    if (!state.injected && nonEmpty(process.env[API_KEY_ENV])) return;
    process.env[API_KEY_ENV] = apiKey;
    state.injected = true;
    return;
  }

  // A reload after credential removal must not retain the previously injected key.
  if (state.injected) delete process.env[API_KEY_ENV];
  state.injected = false;
}

export default function firecrawlAuthExtension(_pi: ExtensionAPI): void {
  applyFirecrawlAuth();
}
