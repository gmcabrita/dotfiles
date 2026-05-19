import { createHash, randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
  BeforeProviderRequestEvent,
} from "@earendil-works/pi-coding-agent";

const OPENCODE_CLIENT = "cli";
const OPENCODE_PROJECT = "global";
const OPENCODE_USER_AGENT = "opencode/1.15.3";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isObject(value)) return false;

  return Object.values(value).every((entry) => typeof entry === "string");
}

function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  const version = "5";
  const variant = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function sessionUuid(ctx: ExtensionContext): string {
  return stableUuid(ctx.sessionManager.getSessionId());
}

export default function (pi: ExtensionAPI) {
  pi.on("before_provider_request", (event: BeforeProviderRequestEvent, ctx: ExtensionContext) => {
    const model = ctx.model;
    if (!model || !model.provider.includes("opencode")) return;
    if (!isObject(event.payload)) return;

    const opencode = isObject(event.payload.opencode) ? event.payload.opencode : {};
    const headers = isStringRecord(opencode.headers) ? opencode.headers : {};

    return {
      ...event.payload,
      opencode: {
        ...opencode,
        headers: {
          ...headers,
          "x-opencode-session": sessionUuid(ctx),
          "x-opencode-request": randomUUID(),
          "x-opencode-client": OPENCODE_CLIENT,
          "x-opencode-project": OPENCODE_PROJECT,
          "User-Agent": OPENCODE_USER_AGENT,
        },
      },
    };
  });
}
