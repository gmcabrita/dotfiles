import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, DynamicBorder, getAgentDir, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, Input, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";

/**
 * Startup model selection.
 *
 * 1. Apply `settings.startup` (default provider/model/thinkingLevel) when no explicit CLI flags were passed.
 * 2. Ask which purpose this session has (implement/review/...) and switch to the model configured for it in
 *    `settings.sessionPurpose`. Escape keeps the startup default.
 *
 * Both steps skip when `--provider` or `--model` is passed on the CLI. The purpose prompt also skips when a
 * session is resumed, because the resumed session already carries its own model history. Project settings
 * are only read when the project is trusted. A project purpose replaces the global purpose with the same name.
 *
 * settings.json shape:
 * {
 *   "startup": { "provider": "anthropic", "model": "claude-fable-5-1", "thinkingLevel": "high" },
 *   "sessionPurpose": {
 *     "implement": { "provider": "anthropic", "model": "claude-fable-5-1", "thinkingLevel": "high" },
 *     "review": { "provider": "openai-codex-lb", "model": "gpt-6-astra", "thinkingLevel": "xhigh" }
 *   }
 * }
 */

const PURPOSE_ENTRY_TYPE = "session-purpose";

type ModelSelection = {
	provider: string;
	model: string;
	thinkingLevel?: ThinkingLevel;
};

type StartupConfig = Partial<ModelSelection>;

type PurposeConfig = {
	name: string;
	selection: ModelSelection;
};

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

function readPurposeConfigs(settings: Record<string, unknown>): Map<string, ModelSelection> {
	const purposes = new Map<string, ModelSelection>();
	const raw = settings.sessionPurpose;
	if (!isRecord(raw)) return purposes;

	for (const [name, value] of Object.entries(raw)) {
		const selection = readModelSelection(value);
		// A purpose without provider and model cannot switch models, so it is dropped.
		if (!selection.provider || !selection.model) continue;
		purposes.set(name, {
			provider: selection.provider,
			model: selection.model,
			thinkingLevel: selection.thinkingLevel,
		});
	}

	return purposes;
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

/** Project purposes override global purposes with the same name. Global key order is kept. */
function getPurposeConfigs(settings: ReturnType<typeof loadSettings>): PurposeConfig[] {
	const merged = readPurposeConfigs(settings.global);
	for (const [name, selection] of readPurposeConfigs(settings.project)) {
		merged.set(name, selection);
	}

	return [...merged.entries()].map(([name, selection]) => ({ name, selection }));
}

function formatSelection(selection: ModelSelection): string {
	const base = `${selection.provider}/${selection.model}`;
	return selection.thinkingLevel ? `${base} (${selection.thinkingLevel})` : base;
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

/** A resumed session already has messages or a recorded purpose on any branch; do not ask again. */
function sessionAlreadyStarted(ctx: ExtensionContext): boolean {
	return ctx.sessionManager
		.getEntries()
		.some(
			(entry) =>
				entry.type === "message" || (entry.type === "custom" && entry.customType === PURPOSE_ENTRY_TYPE),
		);
}

/** Keys owned by the list; every other key goes to the search input. */
const SELECT_LIST_KEYBINDINGS = ["tui.select.up", "tui.select.down", "tui.select.confirm", "tui.select.cancel"] as const;

/** Select dialog with a fuzzy search input above the list. Resolves with the chosen item value or undefined. */
function selectWithSearch(ctx: ExtensionContext, title: string, items: SelectItem[]): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
		const border = () => new DynamicBorder((text) => theme.fg("accent", text));
		const container = new Container();
		container.addChild(border());
		container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));

		const search = new Input({ placeholder: "type to filter", placeholderStyle: (text) => theme.fg("dim", text) });
		search.focused = true;
		container.addChild(search);

		// The list is rebuilt on every filter change because SelectList.setFilter only matches value prefixes.
		const listHolder = new Container();
		container.addChild(listHolder);
		let list: SelectList;
		const rebuildList = () => {
			const filtered = fuzzyFilter(items, search.getValue(), (item) => `${item.label} ${item.description ?? ""}`);
			listHolder.clear();
			list = new SelectList(filtered, Math.min(Math.max(filtered.length, 1), 10), getSelectListTheme());
			list.onSelect = (item) => done(item.value);
			list.onCancel = () => done(undefined);
			listHolder.addChild(list);
		};
		rebuildList();

		container.addChild(new Text(theme.fg("dim", "type to filter • ↑↓ navigate • enter select • esc cancel"), 1, 0));
		container.addChild(border());

		return {
			render: (width) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				if (SELECT_LIST_KEYBINDINGS.some((id) => keybindings.matches(data, id))) {
					list.handleInput(data);
				} else {
					search.handleInput(data);
					rebuildList();
				}
				tui.requestRender();
			},
		};
	});
}

async function askSessionPurpose(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	purposes: PurposeConfig[],
): Promise<void> {
	const items = purposes.map((purpose) => ({
		value: purpose.name,
		label: purpose.name,
		description: formatSelection(purpose.selection),
	}));
	const choice = await selectWithSearch(ctx, "What is this session for?", items);
	if (choice === undefined) return;

	const purpose = purposes.find((candidate) => candidate.name === choice);
	if (!purpose) return;

	const applied = await applyModel(pi, ctx, purpose.selection, `Purpose ${purpose.name}`);
	if (!applied) return;

	applyThinkingLevel(pi, purpose.selection.thinkingLevel);
	pi.appendEntry(PURPOSE_ENTRY_TYPE, { purpose: purpose.name });
	// Report the effective level: pi clamps the requested level to what the model supports.
	ctx.ui.notify(
		`Purpose: ${purpose.name} → ${formatSelection({ ...purpose.selection, thinkingLevel: pi.getThinkingLevel() })}`,
		"info",
	);
}

export default function startupExtension(pi: ExtensionAPI) {
	const explicitModel = hasCliFlag("provider") || hasCliFlag("model");
	const explicitThinking = hasCliFlag("thinking") || modelFlagHasThinkingSuffix();

	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "startup") return;

		const settings = loadSettings(ctx);
		const startup = getStartupConfig(settings);
		const resumed = sessionAlreadyStarted(ctx);
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

		if (explicitModel || resumed || ctx.mode !== "tui") return;

		const purposes = getPurposeConfigs(settings);
		if (purposes.length === 0) return;

		await askSessionPurpose(pi, ctx, purposes);
		applyThinkingLevel(pi, cliThinkingLevel);
	});
}
