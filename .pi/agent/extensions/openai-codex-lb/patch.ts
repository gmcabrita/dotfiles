export const CODEX_LB_PATCH_MARKER = "__openAICodexLbPatched";

type SourcePatch = Readonly<{
	description: string;
	before: string;
	after: string;
}>;

const SOURCE_PATCHES = [
	{
		description: "allow Codex LB tool-call replay",
		before: 'const CODEX_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);',
		after: 'const CODEX_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "openai-codex-lb", "opencode"]);',
	},
	{
		description: "preserve the custom API identifier",
		before: '            api: "openai-codex-responses",',
		after: "            api: model.api,",
	},
	{
		description: "accept an opaque Codex LB API key",
		before: "            const accountId = extractAccountId(apiKey);",
		after: "            const accountId = undefined;",
	},
	{
		description: "omit the ChatGPT account header for API-key auth",
		before: '    headers.set("chatgpt-account-id", accountId);',
		after: '    if (accountId) headers.set("chatgpt-account-id", accountId);',
	},
	{
		description: "delegate cloned WebSocket cleanup to the extension lifecycle",
		before: "registerSessionResourceCleanup(closeOpenAICodexWebSocketSessions);",
		after: "// openai-codex-lb closes cloned WebSocket sessions from its session_shutdown handler.",
	},
	{
		description: "remove the original file's stale source map",
		before: "//# sourceMappingURL=openai-codex-responses.js.map",
		after: "// Source map omitted from the dynamically cloned adapter.",
	},
] satisfies readonly SourcePatch[];

function countOccurrences(source: string, fragment: string): number {
	let count = 0;
	let offset = 0;

	while (true) {
		const index = source.indexOf(fragment, offset);
		if (index === -1) return count;
		count += 1;
		offset = index + fragment.length;
	}
}

function replaceExactlyOnce(source: string, patch: SourcePatch): string {
	const count = countOccurrences(source, patch.before);
	if (count !== 1) {
		throw new Error(
			`Cannot patch OpenAI Codex adapter to ${patch.description}: expected one source match, found ${count}`,
		);
	}

	return source.replace(patch.before, patch.after);
}

/**
 * Produces an isolated Codex adapter variant that authenticates to codex-lb.
 * Exact, fail-closed replacements prevent silent behavior changes after pi upgrades.
 */
export function patchOpenAICodexAdapter(source: string): string {
	let patched = source;
	for (const patch of SOURCE_PATCHES) patched = replaceExactlyOnce(patched, patch);

	return `${patched}\nexport const ${CODEX_LB_PATCH_MARKER} = true;\n`;
}
