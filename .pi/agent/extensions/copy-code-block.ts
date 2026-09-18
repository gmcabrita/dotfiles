/**
 * Copy a fenced code block from the last assistant message to the clipboard.
 *
 * Usage:
 * - `/copy-code`      pick a block (or copy directly when there is only one)
 * - `/copy-code 2`    copy the second block without a picker
 * - ctrl+shift+x      same as `/copy-code`
 */
import {
	copyToClipboard,
	ExtensionSelectorComponent,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key, TuiAltScreen } from "@earendil-works/pi-tui";

export interface CodeBlock {
	language: string;
	code: string;
}

// Matches an opening fence: optional indent, three or more backticks or tildes, then an info string.
const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;

/** Extract fenced code blocks from Markdown, in document order. */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
	const blocks: CodeBlock[] = [];
	const lines = markdown.split("\n");
	let open: { fence: string; language: string; lines: string[] } | undefined;

	for (const line of lines) {
		if (open) {
			// A closing fence uses the same character and at least the same length as the opener.
			const trimmed = line.trim();
			if (trimmed.startsWith(open.fence) && /^[`~]+$/.test(trimmed)) {
				blocks.push({ language: open.language, code: open.lines.join("\n") });
				open = undefined;
			} else {
				open.lines.push(line);
			}
			continue;
		}
		const match = FENCE_OPEN.exec(line);
		if (match) open = { fence: match[1], language: match[2], lines: [] };
	}

	// Streaming may leave a block without a closing fence; keep it so the user can still copy it.
	if (open) {
		const code = open.lines.join("\n").trimEnd();
		if (code.length > 0) blocks.push({ language: open.language, code });
	}
	return blocks;
}

function lastAssistantText(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const content = entry.message.content;
		if (typeof content === "string") return content;
		return content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	}
	return undefined;
}

/**
 * Map a raw key press to a zero-based block index when it is a single digit 1-9 within range.
 * Lets the picker copy block N directly instead of arrowing to it and pressing enter.
 */
export function digitKeyToIndex(keyData: string, count: number): number | undefined {
	if (!/^[1-9]$/.test(keyData)) return undefined;
	const index = Number(keyData) - 1;
	return index < count ? index : undefined;
}

/** Show the block picker. Arrow keys + enter or a digit key choose a block; escape cancels. */
async function pickBlock(ctx: ExtensionContext, blocks: CodeBlock[]): Promise<number | undefined> {
	const labels = blocks.map(describeBlock);
	const choice = await ctx.ui.custom<string | undefined>((tui, _theme, _keybindings, done) => {
		const selector = new ExtensionSelectorComponent(
			"Copy code block (press its number to copy)",
			labels,
			done,
			() => done(undefined),
			{ tui },
		);
		const baseHandleInput = selector.handleInput.bind(selector);
		selector.handleInput = (keyData) => {
			const index = digitKeyToIndex(keyData, labels.length);
			if (index !== undefined) {
				done(labels[index]);
				return;
			}
			baseHandleInput(keyData);
		};
		return selector;
	});
	if (choice === undefined) return undefined;
	const index = labels.indexOf(choice);
	return index === -1 ? undefined : index;
}

function describeBlock(block: CodeBlock, index: number): string {
	const firstLine = block.code.split("\n").find((line) => line.trim().length > 0) ?? "";
	const lineCount = block.code.split("\n").length;
	const language = block.language || "text";
	const preview = firstLine.trim().slice(0, 60);
	return `${index + 1}. [${language}] ${preview} (${lineCount} line${lineCount === 1 ? "" : "s"})`;
}

/**
 * Show a transient toast like the built-in `/copy` (ctrl+x) does.
 *
 * The extension UI API has no toast method, so borrow the TUI instance via `custom` and close the
 * dialog before it mounts. `TuiAltScreen.flash` only exists in alt-screen mode; other modes fall
 * back to an inline notification.
 */
async function flashOrNotify(ctx: ExtensionContext, message: string): Promise<void> {
	let flashed = false;
	await ctx.ui.custom<void>(
		(tui, _theme, _keybindings, done) => {
			if (tui instanceof TuiAltScreen) {
				tui.flash(message);
				flashed = true;
			}
			done();
			return { render: () => [], invalidate: () => {} };
		},
		{ overlay: true },
	);
	if (!flashed) ctx.ui.notify(message, "info");
}

async function copyBlock(ctx: ExtensionContext, block: CodeBlock, index: number): Promise<void> {
	await copyToClipboard(block.code);
	await flashOrNotify(ctx, `Copied code block ${index + 1} (${block.language || "text"})`);
}

async function copyCodeBlock(ctx: ExtensionContext, requested?: number): Promise<void> {
	const text = lastAssistantText(ctx);
	if (text === undefined) {
		ctx.ui.notify("No assistant message found", "warning");
		return;
	}
	const blocks = extractCodeBlocks(text);
	if (blocks.length === 0) {
		ctx.ui.notify("No code block in the last assistant message", "warning");
		return;
	}

	if (requested !== undefined) {
		const block = blocks[requested - 1];
		if (!block) {
			ctx.ui.notify(`Code block ${requested} not found (${blocks.length} available)`, "warning");
			return;
		}
		await copyBlock(ctx, block, requested - 1);
		return;
	}

	if (blocks.length === 1) {
		await copyBlock(ctx, blocks[0], 0);
		return;
	}

	const index = await pickBlock(ctx, blocks);
	if (index === undefined) return;
	await copyBlock(ctx, blocks[index], index);
}

export default function copyCodeBlockExtension(pi: ExtensionAPI): void {
	pi.registerCommand("copy-code", {
		description: "Copy a code block from the last assistant message (optional block number)",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const requested = trimmed === "" ? undefined : Number.parseInt(trimmed, 10);
			if (requested !== undefined && (!Number.isInteger(requested) || requested < 1)) {
				ctx.ui.notify(`Invalid block number: ${trimmed}`, "warning");
				return;
			}
			await copyCodeBlock(ctx, requested);
		},
	});

	pi.registerShortcut(Key.ctrlShift("x"), {
		description: "Copy a code block from the last assistant message",
		handler: (ctx) => copyCodeBlock(ctx),
	});
}
