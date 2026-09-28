import { randomInt } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
  BeforeProviderRequestEvent,
} from "@earendil-works/pi-coding-agent";

const OPENCODE_CLIENT = "cli";
// Zen rejects free tier requests from versions older than 1.18.0.
const OPENCODE_USER_AGENT = "opencode/1.18.33";
// OpenCode IDs are 12 hex chars of timestamp plus 14 base62 chars.
// Zen rejects free tier requests when the session or request ID has another shape.
const OPENCODE_ID_RANDOM_LENGTH = 14;
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

let lastIdTimestamp = 0;
let idCounter = 0;

// Mirrors packages/opencode/src/id/id.ts: sessions sort descending, messages ascending.
function opencodeId(prefix: "ses" | "msg", direction: "ascending" | "descending"): string {
  const timestamp = Date.now();
  if (timestamp !== lastIdTimestamp) {
    lastIdTimestamp = timestamp;
    idCounter = 0;
  }
  idCounter += 1;

  let now = BigInt(timestamp) * 0x1000n + BigInt(idCounter);
  if (direction === "descending") now = ~now;
  const time = BigInt.asUintN(48, now).toString(16).padStart(12, "0");

  let random = "";
  for (let index = 0; index < OPENCODE_ID_RANDOM_LENGTH; index += 1) {
    random += OPENCODE_ID_ALPHABET.charAt(randomInt(OPENCODE_ID_ALPHABET.length));
  }

  return `${prefix}_${time}${random}`;
}

function sessionId(ctx: ExtensionContext): string {
  const piSessionId = ctx.sessionManager.getSessionId();
  const existing = sessionIds.get(piSessionId);
  if (existing) return existing;

  const id = opencodeId("ses", "descending");
  sessionIds.set(piSessionId, id);

  return id;
}

function opencodeHeaders(ctx: ExtensionContext): Record<string, string> {
  return {
    "x-opencode-session": sessionId(ctx),
    "x-opencode-request": opencodeId("msg", "ascending"),
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
