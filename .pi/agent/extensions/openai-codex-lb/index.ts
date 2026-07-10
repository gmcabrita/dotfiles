import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadOpenAICodexLbAdapter, resolveCodexAdapterUrl } from "./clone.ts";
import { loadOpenAICodexModels } from "./models.ts";

export const PROVIDER_ID = "openai-codex-lb";
export const API_ID = "openai-codex-lb-responses";

const API_KEY_ENV = "CODEX_LB_API_KEY";
const BASE_URL_ENV = "CODEX_LB_BASE_URL";
const DEFAULT_BASE_URL = "http://codexlb00.usce1.mgmt.internal.amplemarket.com:2455/backend-api";
const FALLBACK_AUTH_PROVIDER = "openai";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCodexLbApiKey(value: unknown): value is string {
	return typeof value === "string" && value.startsWith("sk-clb-") && value.length > "sk-clb-".length;
}

export function findCodexLbApiKey(authFile: unknown): string | undefined {
	if (!isRecord(authFile)) return undefined;
	const credential = authFile[FALLBACK_AUTH_PROVIDER];
	if (!isRecord(credential) || credential.type !== "api_key") return undefined;
	return isCodexLbApiKey(credential.key) ? credential.key : undefined;
}

function readFallbackApiKey(agentDir: string): string | undefined {
	try {
		const authFile: unknown = JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8"));
		return findCodexLbApiKey(authFile);
	} catch {
		return undefined;
	}
}

export function resolveApiKeyConfig(agentDir: string, environment: NodeJS.ProcessEnv = process.env): string {
	const environmentKey = environment[API_KEY_ENV];
	if (environmentKey !== undefined && environmentKey.trim().length > 0) {
		if (!isCodexLbApiKey(environmentKey.trim())) {
			throw new Error(`${API_KEY_ENV} must contain a codex-lb API key`);
		}
		return `$${API_KEY_ENV}`;
	}

	return readFallbackApiKey(agentDir) ?? `$${API_KEY_ENV}`;
}

export function normalizeBaseUrl(value: string): string {
	const url = new URL(value);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`${BASE_URL_ENV} must use http or https`);
	}

	url.search = "";
	url.hash = "";
	url.pathname = url.pathname.replace(/\/+$/, "");
	if (
		!url.pathname.endsWith("/backend-api") &&
		!url.pathname.endsWith("/backend-api/codex") &&
		!url.pathname.endsWith("/backend-api/codex/responses")
	) {
		throw new Error(`${BASE_URL_ENV} must target codex-lb's /backend-api Codex route`);
	}

	return url.toString().replace(/\/+$/, "");
}

/** Registers an isolated Codex adapter backed by codex-lb's API-key-authenticated Codex route. */
export default async function openAICodexLbExtension(pi: ExtensionAPI) {
	const adapterUrl = resolveCodexAdapterUrl();
	const [adapter, models] = await Promise.all([
		loadOpenAICodexLbAdapter({ sourceUrl: adapterUrl }),
		loadOpenAICodexModels(adapterUrl),
	]);
	const baseUrl = normalizeBaseUrl(process.env[BASE_URL_ENV] ?? DEFAULT_BASE_URL);

	pi.registerProvider(PROVIDER_ID, {
		name: "OpenAI Codex LB",
		baseUrl,
		apiKey: resolveApiKeyConfig(getAgentDir()),
		api: API_ID,
		models,
		streamSimple: adapter.streamSimple,
	});

	pi.on("session_shutdown", () => {
		adapter.closeOpenAICodexWebSocketSessions();
		adapter.resetOpenAICodexWebSocketDebugStats();
	});
}
