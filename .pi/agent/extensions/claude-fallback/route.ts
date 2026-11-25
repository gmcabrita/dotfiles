export const SUBSCRIPTION_PROVIDER = "anthropic";
export const API_PROVIDER = "openrouter";

export type Backend = "subscription" | "api";

export interface ClaudeModel {
	id: string;
	name: string;
	subscriptionId: string;
	apiId: string;
}

export const CLAUDE_MODELS: readonly ClaudeModel[] = [
	{ id: "opus", name: "Claude Opus 5.5", subscriptionId: "claude-opus-5-5", apiId: "anthropic/claude-opus-5.5" },
	{ id: "sonnet", name: "Claude Sonnet 5.5", subscriptionId: "claude-sonnet-5-5", apiId: "anthropic/claude-sonnet-5.5" },
	{ id: "haiku", name: "Claude Haiku 5.5", subscriptionId: "claude-haiku-5-5", apiId: "anthropic/claude-haiku-5.5" },
];

/** Used when neither the response headers nor the OAuth usage endpoint report when the limit resets. */
export const DEFAULT_BLOCK_MS = 30 * 60 * 1000;

const SUBSCRIPTION_LIMIT_ERROR = /exceed.*rate.?limit|usage.?limit|extra usage/i;

export function isSubscriptionLimitError(provider: string, errorMessage: string | undefined): boolean {
	return provider === SUBSCRIPTION_PROVIDER && errorMessage !== undefined && SUBSCRIPTION_LIMIT_ERROR.test(errorMessage);
}

/**
 * Anthropic marks subscription (OAuth) requests over the 5h or weekly window with
 * `anthropic-ratelimit-unified-status: rejected` and the window's reset as epoch seconds.
 */
export function blockedUntilFromHeaders(headers: Record<string, string>): number | undefined {
	if (headers["anthropic-ratelimit-unified-status"] !== "rejected") return undefined;
	const resetSeconds = Number(headers["anthropic-ratelimit-unified-reset"]);
	return Number.isFinite(resetSeconds) && resetSeconds > 0 ? resetSeconds * 1000 : undefined;
}

export interface UsageWindow {
	percent: number;
	resetsAt: Date | null;
}

/** The block lasts until the last exhausted window resets, e.g. the weekly one when both are full. */
export function blockedUntilFromUsage(windows: readonly UsageWindow[]): number | undefined {
	const resets = windows.flatMap((window) =>
		window.percent >= 100 && window.resetsAt !== null ? [window.resetsAt.getTime()] : [],
	);
	return resets.length > 0 ? Math.max(...resets) : undefined;
}

export interface RouteInput {
	reason: "user" | "continuation" | "retry" | "direct";
	stickyProvider: string | undefined;
	blocked: boolean;
}

/**
 * Turns started on API credits finish there, so the prompt cache and thinking signatures stay
 * valid; the next user message returns to the subscription once the window has reset.
 */
export function chooseBackend({ reason, stickyProvider, blocked }: RouteInput): Backend {
	if (blocked) return "api";
	if ((reason === "continuation" || reason === "retry") && stickyProvider === API_PROVIDER) return "api";
	return "subscription";
}

export type BackendNotice = { kind: "api"; blockedUntil: number } | { kind: "subscription" };

/** A notice when a request uses a different backend than the conversation's last response, or starts on API credits. */
export function backendNotice(stickyProvider: string | undefined, backend: Backend, blockedUntil: number): BackendNotice | undefined {
	const wasApi = stickyProvider === API_PROVIDER;
	if (backend === "api" && !wasApi) return { kind: "api", blockedUntil };
	if (backend === "subscription" && wasApi) return { kind: "subscription" };
	return undefined;
}

function formatResetTime(at: Date, now: Date): string {
	const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	if (at.toDateString() === now.toDateString()) return time;
	return `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

export function formatBackendNotice(notice: BackendNotice, now: Date): string {
	if (notice.kind === "subscription") return "Claude subscription available again: back from OpenRouter API credits";
	const until = notice.blockedUntil > now.getTime() ? ` until ${formatResetTime(new Date(notice.blockedUntil), now)}` : "";
	return `Claude subscription limit reached: using API credits via OpenRouter${until}`;
}
