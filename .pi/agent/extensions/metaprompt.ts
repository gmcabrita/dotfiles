/**
 * Metaprompt: let the model write a prompt for a query, then start a new session with it.
 *
 * Usage:
 *   /metaprompt <query>
 *
 * Flow:
 *   1. Ask the current model: "write a prompt for <query>".
 *   2. Start a new session (parented to the current one).
 *   3. Put the generated prompt in the editor of the new session so the user can review it before sending.
 */

import { type Message, uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";

const SYSTEM_PROMPT =
	"You write prompts for an AI coding assistant. Output only the prompt itself, with no preamble, commentary, or surrounding code fence.";

function buildRequest(query: string): string {
	return `write a prompt for ${query}`;
}

export default function metapromptExtension(pi: ExtensionAPI) {
	pi.registerCommand("metaprompt", {
		description: "Generate a prompt for a query, then review it in a new session",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("metaprompt requires interactive mode", "error");
				return;
			}

			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const query = args.trim();
			if (!query) {
				ctx.ui.notify("Usage: /metaprompt <query>", "error");
				return;
			}

			const generated = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, "Generating prompt...");
				loader.onAbort = () => done(null);

				const generate = async (): Promise<string | null> => {
					const message: Message = {
						role: "user",
						content: [{ type: "text", text: buildRequest(query) }],
						timestamp: Date.now(),
					};
					const response = await ctx.modelRegistry.complete(
						model,
						{ systemPrompt: SYSTEM_PROMPT, messages: [message] },
						{ signal: loader.signal, cacheRetention: "none", sessionId: uuidv7() },
					);
					if (response.stopReason === "aborted") return null;

					return response.content
						.filter((part): part is { type: "text"; text: string } => part.type === "text")
						.map((part) => part.text)
						.join("\n")
						.trim();
				};

				generate()
					.then(done)
					.catch((error) => {
						console.error("metaprompt generation failed:", error);
						ctx.ui.notify(`metaprompt failed: ${error instanceof Error ? error.message : String(error)}`, "error");
						done(null);
					});

				return loader;
			});

			if (!generated) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			// The old ctx is stale after the session switch; use replacementCtx for UI work.
			const result = await ctx.newSession({
				parentSession: ctx.sessionManager.getSessionFile(),
				withSession: async (replacementCtx) => {
					replacementCtx.ui.setEditorText(generated);
					replacementCtx.ui.notify("Prompt ready. Review it, then submit.", "info");
				},
			});

			if (result.cancelled) {
				ctx.ui.notify("New session cancelled", "info");
			}
		},
	});
}
