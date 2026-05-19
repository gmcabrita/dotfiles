import { randomInt } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
  BeforeProviderRequestEvent,
} from "@earendil-works/pi-coding-agent";

const OPENCODE_CLIENT = "cli";
const OPENCODE_USER_AGENT = "opencode/1.15.5";
const OPENCODE_ID_LENGTH = 26;
const OPENCODE_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const OPENCODE_HEADERS_KEY = Symbol.for("pi.opencodeHeaders.headers");
const OPENCODE_FETCH_PATCH_KEY = Symbol.for("pi.opencodeHeaders.fetchPatched");

const sessionIds = new Map<string, string>();

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isObject(value)) return false;

  return Object.values(value).every((entry) => typeof entry === "string");
}

function randomId(): string {
  let id = "";

  for (let index = 0; index < OPENCODE_ID_LENGTH; index += 1) {
    id += OPENCODE_ID_ALPHABET.charAt(randomInt(OPENCODE_ID_ALPHABET.length));
  }

  return id;
}

function sessionId(ctx: ExtensionContext): string {
  const piSessionId = ctx.sessionManager.getSessionId();
  const existing = sessionIds.get(piSessionId);
  if (existing) return existing;

  const id = randomId();
  sessionIds.set(piSessionId, id);

  return id;
}

function opencodeHeaders(ctx: ExtensionContext): Record<string, string> {
  return {
    "x-opencode-session": `ses_${sessionId(ctx)}`,
    "x-opencode-request": `msg_${randomId()}`,
    "x-opencode-client": OPENCODE_CLIENT,
    "User-Agent": OPENCODE_USER_AGENT,
  };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string | undefined {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();

  return input.url;
}

function isOpencodeUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "opencode.ai";
  } catch {
    return false;
  }
}

function currentOpencodeHeaders(): Record<string, string> | undefined {
  const headers = Reflect.get(globalThis, OPENCODE_HEADERS_KEY);
  if (!isStringRecord(headers)) return undefined;

  return headers;
}

function patchFetch(): void {
  if (Reflect.get(globalThis, OPENCODE_FETCH_PATCH_KEY) === true) return;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const headers = currentOpencodeHeaders();
    const url = requestUrl(input);
    if (!headers || !url || !isOpencodeUrl(url)) return originalFetch(input, init);

    const nextHeaders = new Headers(init?.headers);
    if (input instanceof Request) {
      for (const [key, value] of input.headers.entries()) {
        if (!nextHeaders.has(key)) nextHeaders.set(key, value);
      }
    }

    for (const [key, value] of Object.entries(headers)) {
      nextHeaders.set(key, value);
    }

    return originalFetch(input, { ...init, headers: nextHeaders });
  };

  Reflect.set(globalThis, OPENCODE_FETCH_PATCH_KEY, true);
}

export default function (pi: ExtensionAPI) {
  patchFetch();

  pi.on("before_provider_request", (event: BeforeProviderRequestEvent, ctx: ExtensionContext) => {
    const model = ctx.model;
    if (!model || !model.provider.includes("opencode")) return;
    if (!isObject(event.payload)) return;

    Reflect.set(globalThis, OPENCODE_HEADERS_KEY, opencodeHeaders(ctx));
  });

  pi.on("after_provider_response", (_event) => {
    Reflect.deleteProperty(globalThis, OPENCODE_HEADERS_KEY);
  });
}
