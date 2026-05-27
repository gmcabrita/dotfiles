import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type ReviewConfig = {
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

function readReviewConfig(settings: Record<string, unknown>): ReviewConfig {
	const review = settings.review;
	if (!isRecord(review)) return {};

	return {
		model: readString(review.model),
		provider: readString(review.provider),
		thinkingLevel: isThinkingLevel(review.thinkingLevel) ? review.thinkingLevel : undefined,
	};
}

function getReviewConfig(cwd: string): ReviewConfig {
	const globalSettings = readSettings(join(getAgentDir(), "settings.json"));
	const projectSettings = readSettings(join(cwd, ".pi", "settings.json"));
	const globalReview = readReviewConfig(globalSettings);
	const projectReview = readReviewConfig(projectSettings);

	return {
		model: projectReview.model ?? globalReview.model,
		provider: projectReview.provider ?? globalReview.provider,
		thinkingLevel: projectReview.thinkingLevel ?? globalReview.thinkingLevel,
	};
}

function isReviewPrompt(prompt: string): boolean {
	return prompt.includes("Please perform a code review");
}

export default function reviewThinkingExtension(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		if (!isReviewPrompt(event.prompt)) return;

		const review = getReviewConfig(ctx.cwd);
		if (!review.model && !review.provider && !review.thinkingLevel) return;

		if (review.provider && review.model) {
			const model = ctx.modelRegistry.find(review.provider, review.model);
			if (!model) {
				ctx.ui.notify(`Review: model not found ${review.provider}/${review.model}`, "warning");
			} else if (ctx.model?.provider !== model.provider || ctx.model.id !== model.id) {
				const success = await pi.setModel(model);
				if (!success) {
					ctx.ui.notify(`Review: no API key for ${review.provider}/${review.model}`, "warning");
				}
			}
		}

		if (review.thinkingLevel && pi.getThinkingLevel() !== review.thinkingLevel) {
			pi.setThinkingLevel(review.thinkingLevel);
		}
	});
}
