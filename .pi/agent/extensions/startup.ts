import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Startup model selection.
 *
 * Apply `settings.startup` (default provider/model/thinkingLevel) at startup. The model is skipped when
 * `--provider` or `--model` is passed on the CLI. An explicit `--thinking` (or `--model ...:level`) wins over
 * the configured thinking level. Project settings are only read when the project is trusted, and project
 * values override global values.
 *
 * settings.json shape:
 * {
 *   "startup": { "provider": "anthropic", "model": "claude-fable-5-1", "thinkingLevel": "high" }
 * }
 */

type ModelSelection = {
	provider: string;
	model: string;
	thinkingLevel?: ThinkingLevel;
};

type StartupConfig = Partial<ModelSelection>;

function getCliFlag(name: string): string | undefined {
	const flag = `--${name}`;
	const args = process.argv.slice(2);

	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--") return undefined;
		if (argument === flag) return args[index + 1] ?? "";
		if (argument.startsWith(`${flag}=`)) return argument.slice(flag.length + 1);
	}

	return undefined;
}

function hasCliFlag(name: string): boolean {
	return getCliFlag(name) !== undefined;
}

/** `--model provider/model:level` carries its own thinking level. */
function modelFlagHasThinkingSuffix(): boolean {
	const value = getCliFlag("model");
	return value !== undefined && value.includes(":");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	switch (value) {
		case "off":
		case "minimal":
		case "low":
		case "medium":
		case "high":
		case "xhigh":
		case "max":
			return true;
		default:
			return false;
	}
}

function readSettings(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};

	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (isRecord(parsed)) return parsed;
	} catch {
		return {};
	}

	return {};
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readModelSelection(value: unknown): StartupConfig {
	if (!isRecord(value)) return {};

	return {
		model: readString(value.model),
		provider: readString(value.provider),
		thinkingLevel: isThinkingLevel(value.thinkingLevel) ? value.thinkingLevel : undefined,
	};
}

function loadSettings(ctx: ExtensionContext): { global: Record<string, unknown>; project: Record<string, unknown> } {
	return {
		global: readSettings(join(getAgentDir(), "settings.json")),
		project: ctx.isProjectTrusted() ? readSettings(join(ctx.cwd, CONFIG_DIR_NAME, "settings.json")) : {},
	};
}

function getStartupConfig(settings: ReturnType<typeof loadSettings>): StartupConfig {
	const globalStartup = readModelSelection(settings.global.startup);
	const projectStartup = readModelSelection(settings.project.startup);

	return {
		model: projectStartup.model ?? globalStartup.model,
		provider: projectStartup.provider ?? globalStartup.provider,
		thinkingLevel: projectStartup.thinkingLevel ?? globalStartup.thinkingLevel,
	};
}

/** Returns true when the model was set (or was already active). */
async function applyModel(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	selection: ModelSelection,
	label: string,
): Promise<boolean> {
	const model = ctx.modelRegistry.find(selection.provider, selection.model);
	if (!model) {
		ctx.ui.notify(`${label}: model not found ${selection.provider}/${selection.model}`, "warning");
		return false;
	}

	if (ctx.model?.provider === model.provider && ctx.model.id === model.id) return true;

	const success = await pi.setModel(model);
	if (!success) {
		ctx.ui.notify(`${label}: no API key for ${selection.provider}/${selection.model}`, "warning");
	}
	return success;
}

function applyThinkingLevel(pi: ExtensionAPI, level: ThinkingLevel | undefined): void {
	if (level && pi.getThinkingLevel() !== level) {
		pi.setThinkingLevel(level);
	}
}

export default function startupExtension(pi: ExtensionAPI) {
	const explicitModel = hasCliFlag("provider") || hasCliFlag("model");
	const explicitThinking = hasCliFlag("thinking") || modelFlagHasThinkingSuffix();

	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "startup") return;

		const settings = loadSettings(ctx);
		const startup = getStartupConfig(settings);
		// pi.setModel() resets the thinking level to the model default, so an explicit --thinking must be restored.
		const cliThinkingLevel = explicitThinking ? pi.getThinkingLevel() : undefined;

		if (!explicitModel && startup.provider && startup.model) {
			await applyModel(
				pi,
				ctx,
				{ provider: startup.provider, model: startup.model, thinkingLevel: startup.thinkingLevel },
				"Startup",
			);
		}

		applyThinkingLevel(pi, cliThinkingLevel ?? startup.thinkingLevel);
	});
}
