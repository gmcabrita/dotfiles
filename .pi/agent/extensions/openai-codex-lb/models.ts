const MODEL_EXPORT = "OPENAI_CODEX_MODELS";
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

export async function loadOpenAICodexModels(adapterUrl: URL): Promise<CodexLbModel[]> {
	const modelModuleUrl = new URL("../providers/openai-codex.models.js", adapterUrl);
	const moduleValue: unknown = await import(modelModuleUrl.href);
	return parseCodexModelCatalog(moduleValue);
}
