import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type StartupConfig = {
	model?: string;
	provider?: string;
	thinkingLevel?: ThinkingLevel;
};

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

function readStartupConfig(settings: Record<string, unknown>): StartupConfig {
	const startup = settings.startup;
	if (!isRecord(startup)) return {};

	return {
		model: readString(startup.model),
		provider: readString(startup.provider),
		thinkingLevel: isThinkingLevel(startup.thinkingLevel) ? startup.thinkingLevel : undefined,
	};
}

function getStartupConfig(cwd: string): StartupConfig {
	const globalSettings = readSettings(join(getAgentDir(), "settings.json"));
	const projectSettings = readSettings(join(cwd, ".pi", "settings.json"));
	const globalStartup = readStartupConfig(globalSettings);
	const projectStartup = readStartupConfig(projectSettings);

	return {
		model: projectStartup.model ?? globalStartup.model,
		provider: projectStartup.provider ?? globalStartup.provider,
		thinkingLevel: projectStartup.thinkingLevel ?? globalStartup.thinkingLevel,
	};
}

export default function startupExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (event, ctx) => {
		if ("reason" in event && event.reason !== "startup") return;

		const startup = getStartupConfig(ctx.cwd);

		if (startup.provider && startup.model) {
			const model = ctx.modelRegistry.find(startup.provider, startup.model);
			if (!model) {
				ctx.ui.notify(`Startup: model not found ${startup.provider}/${startup.model}`, "warning");
			} else if (ctx.model?.provider !== model.provider || ctx.model.id !== model.id) {
				const success = await pi.setModel(model);
				if (!success) {
					ctx.ui.notify(`Startup: no API key for ${startup.provider}/${startup.model}`, "warning");
				}
			}
		}

		if (startup.thinkingLevel && pi.getThinkingLevel() !== startup.thinkingLevel) {
			pi.setThinkingLevel(startup.thinkingLevel);
		}
	});
}
