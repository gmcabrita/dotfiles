import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
	Api,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { CODEX_LB_PATCH_MARKER, patchOpenAICodexAdapter } from "./patch.ts";

const CODEX_ADAPTER_SPECIFIER = "@earendil-works/pi-ai/api/openai-codex-responses";
const CODEX_ADAPTER_RELATIVE_PATH = "dist/api/openai-codex-responses.js";
const CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";
const RELATIVE_FROM_PATTERN = /\bfrom\s+(["'])(\.\.?\/[^"']+)\1/g;
const RELATIVE_SIDE_EFFECT_IMPORT_PATTERN = /\bimport\s+(["'])(\.\.?\/[^"']+)\1/g;
const RELATIVE_DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*(["'])(\.\.?\/[^"']+)\1\s*\)/g;
const UNRESOLVED_RELATIVE_IMPORT_PATTERN = /(?:\bfrom\s+|\bimport\s*\(?\s*)["']\.\.?\//;

type StreamSimple = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export type OpenAICodexLbAdapter = Readonly<{
	streamSimple: StreamSimple;
	closeOpenAICodexWebSocketSessions: (sessionId?: string) => void;
	getOpenAICodexWebSocketDebugStats: (sessionId: string) => unknown;
	resetOpenAICodexWebSocketDebugStats: (sessionId?: string) => void;
}>;

type CloneOptions = Readonly<{
	sourceUrl?: URL;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPackageName(packageJsonPath: string): string | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
		return isRecord(parsed) && typeof parsed.name === "string" ? parsed.name : undefined;
	} catch {
		return undefined;
	}
}

function findPackageRoot(startPath: string, packageName: string): string | undefined {
	let directory = dirname(startPath);
	const root = parse(directory).root;

	while (directory !== root) {
		if (readPackageName(join(directory, "package.json")) === packageName) return directory;
		directory = dirname(directory);
	}

	return undefined;
}

function resolveRuntimeCodexAdapterUrl(): URL | undefined {
	const entryPath = process.argv[1];
	if (!entryPath) return undefined;

	try {
		const codingAgentRoot = findPackageRoot(realpathSync(entryPath), CODING_AGENT_PACKAGE);
		if (!codingAgentRoot) return undefined;

		const candidate = join(dirname(codingAgentRoot), "pi-ai", CODEX_ADAPTER_RELATIVE_PATH);
		return existsSync(candidate) ? pathToFileURL(realpathSync(candidate)) : undefined;
	} catch {
		return undefined;
	}
}

export function resolveCodexAdapterUrl(): URL {
	const runtimeUrl = resolveRuntimeCodexAdapterUrl();
	if (runtimeUrl) return runtimeUrl;

	return new URL(import.meta.resolve(CODEX_ADAPTER_SPECIFIER));
}

function isAdapter(value: unknown): value is OpenAICodexLbAdapter {
	return (
		isRecord(value) &&
		value[CODEX_LB_PATCH_MARKER] === true &&
		typeof value.streamSimple === "function" &&
		typeof value.closeOpenAICodexWebSocketSessions === "function" &&
		typeof value.getOpenAICodexWebSocketDebugStats === "function" &&
		typeof value.resetOpenAICodexWebSocketDebugStats === "function"
	);
}

function resolveModuleSpecifier(specifier: string, sourceUrl: URL): string {
	return JSON.stringify(new URL(specifier, sourceUrl).href);
}

export function absolutizeRelativeImports(source: string, sourceUrl: URL): string {
	let replacements = 0;
	const replaceSpecifier = (_match: string, _quote: string, specifier: string): string => {
		replacements += 1;
		return resolveModuleSpecifier(specifier, sourceUrl);
	};

	let transformed = source.replace(
		RELATIVE_FROM_PATTERN,
		(match: string, quote: string, specifier: string) => `from ${replaceSpecifier(match, quote, specifier)}`,
	);
	transformed = transformed.replace(
		RELATIVE_SIDE_EFFECT_IMPORT_PATTERN,
		(match: string, quote: string, specifier: string) => `import ${replaceSpecifier(match, quote, specifier)}`,
	);
	transformed = transformed.replace(
		RELATIVE_DYNAMIC_IMPORT_PATTERN,
		(match: string, quote: string, specifier: string) => `import(${replaceSpecifier(match, quote, specifier)})`,
	);

	if (replacements === 0 || UNRESOLVED_RELATIVE_IMPORT_PATTERN.test(transformed)) {
		throw new Error("Cannot clone OpenAI Codex adapter: relative module imports were not fully resolved");
	}
	return transformed;
}

/** Loads a source-transformed data-URL module without mutating pi's original adapter. */
export async function loadOpenAICodexLbAdapter(options: CloneOptions = {}): Promise<OpenAICodexLbAdapter> {
	const sourceUrl = options.sourceUrl ?? resolveCodexAdapterUrl();
	if (sourceUrl.protocol !== "file:") {
		throw new Error(`OpenAI Codex adapter must resolve to a file URL, received ${sourceUrl.protocol}`);
	}

	const canonicalSourceUrl = pathToFileURL(realpathSync(fileURLToPath(sourceUrl)));
	const source = readFileSync(fileURLToPath(canonicalSourceUrl), "utf8");
	const patchedSource = patchOpenAICodexAdapter(source);
	const cloneSource = absolutizeRelativeImports(patchedSource, canonicalSourceUrl);
	const fingerprint = createHash("sha256").update(cloneSource).digest("hex").slice(0, 16);
	const encodedSource = Buffer.from(`${cloneSource}\n//# sourceURL=openai-codex-lb-${fingerprint}.js\n`).toString("base64");
	const cloneUrl = `data:text/javascript;base64,${encodedSource}#${fingerprint}`;
	const loaded: unknown = await import(cloneUrl);

	if (!isAdapter(loaded)) {
		const exports = isRecord(loaded) ? Object.keys(loaded).sort().join(", ") : typeof loaded;
		throw new Error(`Patched OpenAI Codex adapter has an unexpected export shape: ${exports}`);
	}
	return loaded;
}
