import { readFileSync } from "node:fs";

const MODEL_EXPORT = "OPENAI_CODEX_MODELS";
// `pi update --models` writes refreshed catalogs to models-store.json under the built-in provider ID.
const STORED_PROVIDER_ID = "openai-codex";
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];
type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

type ModelCostTier = Readonly<{
	inputTokensAbove: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}>;

type ModelCost = Readonly<{
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	tiers?: ModelCostTier[];
}>;

export type CodexLbModel = Readonly<{
	id: string;
	name: string;
	reasoning: boolean;
	thinkingLevelMap?: ThinkingLevelMap;
	input: ("text" | "image")[];
	cost: ModelCost;
	contextWindow: number;
	maxTokens: number;
	headers?: Record<string, string>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThinkingLevel(value: string): value is ThinkingLevel {
	return THINKING_LEVELS.some((candidate) => candidate === value);
}

function readRequiredString(record: Record<string, unknown>, field: string): string {
	const value = record[field];
	if (typeof value !== "string" || value.length === 0) throw new Error(`Codex model has invalid ${field}`);
	return value;
}

function readRequiredNumber(record: Record<string, unknown>, field: string): number {
	const value = record[field];
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Codex model has invalid ${field}`);
	return value;
}

function parseThinkingLevelMap(value: unknown): ThinkingLevelMap | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw new Error("Codex model has invalid thinkingLevelMap");

	const result: ThinkingLevelMap = {};
	for (const [level, mappedValue] of Object.entries(value)) {
		if (!isThinkingLevel(level)) {
			throw new Error(`Codex model has unknown thinking level ${level}`);
		}
		if (mappedValue !== null && typeof mappedValue !== "string") {
			throw new Error(`Codex model has invalid thinking level mapping for ${level}`);
		}
		result[level] = mappedValue;
	}
	return result;
}

function parseInput(value: unknown): ("text" | "image")[] {
	if (!Array.isArray(value) || value.length === 0) throw new Error("Codex model has invalid input types");

	const result: ("text" | "image")[] = [];
	for (const input of value) {
		if (input !== "text" && input !== "image") throw new Error(`Codex model has unknown input type ${String(input)}`);
		result.push(input);
	}
	return result;
}

function parseCostTier(value: unknown): ModelCostTier {
	if (!isRecord(value)) throw new Error("Codex model has invalid cost tier");
	return {
		inputTokensAbove: readRequiredNumber(value, "inputTokensAbove"),
		input: readRequiredNumber(value, "input"),
		output: readRequiredNumber(value, "output"),
		cacheRead: readRequiredNumber(value, "cacheRead"),
		cacheWrite: readRequiredNumber(value, "cacheWrite"),
	};
}

function parseCost(value: unknown): ModelCost {
	if (!isRecord(value)) throw new Error("Codex model has invalid cost");
	const tiersValue = value.tiers;
	let tiers: ModelCostTier[] | undefined;
	if (tiersValue !== undefined) {
		if (!Array.isArray(tiersValue)) throw new Error("Codex model has invalid cost tiers");
		tiers = tiersValue.map(parseCostTier);
	}

	return {
		input: readRequiredNumber(value, "input"),
		output: readRequiredNumber(value, "output"),
		cacheRead: readRequiredNumber(value, "cacheRead"),
		cacheWrite: readRequiredNumber(value, "cacheWrite"),
		tiers,
	};
}

function parseHeaders(value: unknown): Record<string, string> | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw new Error("Codex model has invalid headers");

	const headers: Record<string, string> = {};
	for (const [name, headerValue] of Object.entries(value)) {
		if (typeof headerValue !== "string") throw new Error(`Codex model has invalid header ${name}`);
		headers[name] = headerValue;
	}
	return headers;
}

function parseModel(value: unknown): CodexLbModel {
	if (!isRecord(value)) throw new Error("Codex model catalog contains a non-object model");
	if (typeof value.reasoning !== "boolean") throw new Error("Codex model has invalid reasoning flag");

	return {
		id: readRequiredString(value, "id"),
		name: readRequiredString(value, "name"),
		reasoning: value.reasoning,
		thinkingLevelMap: parseThinkingLevelMap(value.thinkingLevelMap),
		input: parseInput(value.input),
		cost: parseCost(value.cost),
		contextWindow: readRequiredNumber(value, "contextWindow"),
		maxTokens: readRequiredNumber(value, "maxTokens"),
		headers: parseHeaders(value.headers),
	};
}

export function parseCodexModelCatalog(moduleValue: unknown): CodexLbModel[] {
	if (!isRecord(moduleValue) || !isRecord(moduleValue[MODEL_EXPORT])) {
		throw new Error(`OpenAI Codex model module does not export ${MODEL_EXPORT}`);
	}

	const models: CodexLbModel[] = [];
	for (const [catalogId, value] of Object.entries(moduleValue[MODEL_EXPORT])) {
		const model = parseModel(value);
		if (model.id !== catalogId) throw new Error(`Codex model catalog key ${catalogId} does not match ${model.id}`);
		models.push(model);
	}
	if (models.length === 0) throw new Error("OpenAI Codex model catalog is empty");
	return models;
}

/** Returns the refreshed openai-codex chat models from a parsed models-store.json. */
export function parseStoredCodexModels(storeFile: unknown): CodexLbModel[] {
	if (!isRecord(storeFile)) throw new Error("models-store.json must contain an object");
	const entry = storeFile[STORED_PROVIDER_ID];
	if (entry === undefined) return [];
	if (!isRecord(entry) || !Array.isArray(entry.models)) {
		throw new Error(`models-store.json has an invalid ${STORED_PROVIDER_ID} entry`);
	}

	// Same filter as pi-ai's store restore: own provider only, chat models only (a missing type means chat).
	return entry.models
		.filter((value) => isRecord(value) && value.provider === STORED_PROVIDER_ID && (value.type ?? "chat") === "chat")
		.map(parseModel);
}

function readStoredCodexModels(storePath: string): CodexLbModel[] {
	let content: string;
	try {
		content = readFileSync(storePath, "utf8");
	} catch (error) {
		if (isRecord(error) && error.code === "ENOENT") return [];
		throw error;
	}
	return parseStoredCodexModels(JSON.parse(content));
}

/** Applies refreshed models over the bundled catalog, matching pi-ai's baseline/dynamic merge. */
export function mergeCodexModels(bundled: CodexLbModel[], stored: CodexLbModel[]): CodexLbModel[] {
	const merged = [...bundled];
	for (const model of stored) {
		const index = merged.findIndex((entry) => entry.id === model.id);
		if (index >= 0) merged[index] = model;
		else merged.push(model);
	}
	return merged;
}

/**
 * Loads the bundled Codex catalog, applies the refreshed catalog from models-store.json,
 * and copies gpt-5.6-luna settings for gpt-reserve.
 */
export async function loadOpenAICodexModels(adapterUrl: URL, storePath: string): Promise<CodexLbModel[]> {
	const modelModuleUrl = new URL("../providers/openai-codex.models.js", adapterUrl);
	const moduleValue: unknown = await import(modelModuleUrl.href);
	const models = mergeCodexModels(parseCodexModelCatalog(moduleValue), readStoredCodexModels(storePath));
	const luna = models.find((model) => model.id === "gpt-5.6-luna");
	if (!luna) throw new Error("Codex LB gpt-reserve requires gpt-5.6-luna in the upstream catalog");
	return [...models, { ...luna, id: "gpt-reserve", name: "gpt-reserve" }];
}
