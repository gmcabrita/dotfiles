import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { anthropicUsageProvider } from "../usage/providers/anthropic.ts";
import {
	API_PROVIDER,
	backendNotice,
	blockedUntilFromHeaders,
	blockedUntilFromUsage,
	chooseBackend,
	CLAUDE_MODELS,
	DEFAULT_BLOCK_MS,
	formatBackendNotice,
	isSubscriptionLimitError,
	SUBSCRIPTION_PROVIDER,
	type BackendNotice,
} from "./route.ts";

const VIRTUAL_PROVIDER = "claude";
const NOTICE_ENTRY = "claude-fallback-notice";

/** Shared through a file so subagent processes skip the subscription while it is blocked. */
const STATE_PATH = join(getAgentDir(), "claude-fallback.json");

function readBlockedUntil(): number {
	try {
		const parsed: unknown = JSON.parse(readFileSync(STATE_PATH, "utf8"));
		const value = (parsed as { blockedUntil?: unknown } | null)?.blockedUntil;
		return typeof value === "number" ? value : 0;
	} catch {
		return 0;
	}
}

function writeBlockedUntil(blockedUntil: number): void {
	const temporary = `${STATE_PATH}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify({ blockedUntil })}\n`);
	renameSync(temporary, STATE_PATH);
}

async function fetchBlockedUntil(ctx: ExtensionContext): Promise<number | undefined> {
	try {
		const auth = await ctx.modelRegistry.getProviderAuth(SUBSCRIPTION_PROVIDER);
		const token = auth?.auth.apiKey;
		if (!token) return undefined;
		const usage = await anthropicUsageProvider.fetch({ token, source: auth.source });
		return blockedUntilFromUsage(usage.rows.flatMap((row) => (row.kind === "limit" ? [row] : [])));
	} catch {
		return undefined;
	}
}

function describeBlock(blockedUntil: number, now: number): string {
	if (blockedUntil <= now) return "Claude subscription active";
	return `Claude subscription blocked until ${new Date(blockedUntil).toLocaleTimeString()}; using API credits via OpenRouter`;
}

export default function claudeFallbackExtension(pi: ExtensionAPI) {
	// Rendered like pi's own cache-miss notices; custom entries stay out of the model context.
	pi.registerEntryRenderer<BackendNotice>(NOTICE_ENTRY, (entry, _options, theme) => {
		if (!entry.data) return undefined;
		const color = entry.data.kind === "api" ? "warning" : "dim";
		const notice = new Container();
		notice.addChild(new Spacer(1));
		notice.addChild(new Text(theme.fg(color, formatBackendNotice(entry.data, new Date(entry.timestamp))), 1, 0));
		return notice;
	});

	for (const claude of CLAUDE_MODELS) {
		pi.registerVirtualModel({
			provider: VIRTUAL_PROVIDER,
			id: claude.id,
			name: claude.name,
			thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
			contextWindow: 1_000_000,
			maxTokens: 128_000,
			async route(request, ctx) {
				const now = Date.now();
				const failed = request.failed;
				if (
					failed &&
					isSubscriptionLimitError(failed.model.provider, failed.message.errorMessage) &&
					readBlockedUntil() <= now
				) {
					const blockedUntil = await fetchBlockedUntil(ctx);
					writeBlockedUntil(blockedUntil !== undefined && blockedUntil > now ? blockedUntil : now + DEFAULT_BLOCK_MS);
				}

				const stickyProvider = (failed ?? request.previous)?.model.provider;
				const blockedUntil = readBlockedUntil();
				const backend = chooseBackend({ reason: request.reason, stickyProvider, blocked: blockedUntil > now });
				const [provider, id] =
					backend === "api" ? [API_PROVIDER, claude.apiId] : [SUBSCRIPTION_PROVIDER, claude.subscriptionId];
				const model = ctx.modelRegistry.find(provider, id);
				if (!model) throw new Error(`${provider}/${id} is not in the model catalog`);

				const notice = request.reason === "direct" ? undefined : backendNotice(stickyProvider, backend, blockedUntil);
				if (notice) pi.appendEntry(NOTICE_ENTRY, notice);
				return { model, thinkingLevel: request.thinkingLevel };
			},
		});
	}

	pi.on("after_provider_response", (event) => {
		const blockedUntil = blockedUntilFromHeaders(event.headers);
		if (blockedUntil !== undefined && blockedUntil > readBlockedUntil()) writeBlockedUntil(blockedUntil);
	});

	pi.registerCommand("claude-fallback", {
		description: "Show the Claude fallback state, force it on for N minutes (default 60), or turn it off",
		handler: async (args, ctx) => {
			const [command = "", minutesArgument] = args.trim().toLowerCase().split(/\s+/);
			const now = Date.now();

			if (command === "on") {
				const minutes = minutesArgument === undefined ? 60 : Number(minutesArgument);
				if (!Number.isFinite(minutes) || minutes <= 0) {
					ctx.ui.notify(`Invalid minutes: ${minutesArgument}`, "warning");
					return;
				}
				writeBlockedUntil(now + minutes * 60_000);
			} else if (command === "off") {
				writeBlockedUntil(0);
			} else if (command !== "" && command !== "status") {
				ctx.ui.notify("Usage: /claude-fallback [status|on [minutes]|off]", "warning");
				return;
			}

			ctx.ui.notify(describeBlock(readBlockedUntil(), now), "info");
		},
	});
}
