import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	backendNotice,
	blockedUntilFromHeaders,
	blockedUntilFromUsage,
	chooseBackend,
	formatBackendNotice,
	isSubscriptionLimitError,
} from "./route.ts";

describe("chooseBackend", () => {
	it("uses the subscription when it is not blocked", () => {
		assert.equal(chooseBackend({ reason: "user", stickyProvider: "anthropic", blocked: false }), "subscription");
	});

	it("uses API credits for every request while blocked", () => {
		for (const reason of ["user", "continuation", "retry", "direct"] as const) {
			assert.equal(chooseBackend({ reason, stickyProvider: "anthropic", blocked: true }), "api");
		}
	});

	it("finishes a turn on API credits after the block expires", () => {
		assert.equal(chooseBackend({ reason: "continuation", stickyProvider: "openrouter", blocked: false }), "api");
		assert.equal(chooseBackend({ reason: "retry", stickyProvider: "openrouter", blocked: false }), "api");
	});

	it("returns to the subscription on the next user message after the block expires", () => {
		assert.equal(chooseBackend({ reason: "user", stickyProvider: "openrouter", blocked: false }), "subscription");
	});
});

describe("backendNotice", () => {
	const blockedUntil = Date.parse("2026-11-25T23:30:00Z");

	it("announces the switch to API credits", () => {
		assert.deepEqual(backendNotice("anthropic", "api", blockedUntil), { kind: "api", blockedUntil });
	});

	it("announces a conversation that starts on API credits", () => {
		assert.deepEqual(backendNotice(undefined, "api", blockedUntil), { kind: "api", blockedUntil });
	});

	it("announces the return to the subscription", () => {
		assert.deepEqual(backendNotice("openrouter", "subscription", 0), { kind: "subscription" });
	});

	it("stays quiet while the backend is unchanged", () => {
		assert.equal(backendNotice("openrouter", "api", blockedUntil), undefined);
		assert.equal(backendNotice("anthropic", "subscription", 0), undefined);
		assert.equal(backendNotice(undefined, "subscription", 0), undefined);
	});

	it("includes the reset time while it is in the future", () => {
		const now = new Date("2026-11-25T20:00:00Z");
		assert.match(formatBackendNotice({ kind: "api", blockedUntil }, now), /^Claude subscription limit reached: using API credits via OpenRouter until /);
		assert.equal(
			formatBackendNotice({ kind: "api", blockedUntil: now.getTime() - 1 }, now),
			"Claude subscription limit reached: using API credits via OpenRouter",
		);
	});
});

describe("isSubscriptionLimitError", () => {
	it("matches Anthropic rate-limit errors", () => {
		assert.ok(
			isSubscriptionLimitError(
				"anthropic",
				'429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."}}',
			),
		);
		assert.ok(isSubscriptionLimitError("anthropic", "You're out of extra usage."));
	});

	it("ignores other errors and other providers", () => {
		assert.ok(!isSubscriptionLimitError("anthropic", "529 overloaded_error"));
		assert.ok(!isSubscriptionLimitError("anthropic", "500 internal server error"));
		assert.ok(!isSubscriptionLimitError("openrouter", "429 rate limit"));
		assert.ok(!isSubscriptionLimitError("anthropic", undefined));
	});
});

describe("blockedUntilFromUsage", () => {
	const session = new Date("2026-11-25T20:00:00Z");
	const weekly = new Date("2026-11-28T09:00:00Z");

	it("uses the reset of the exhausted window", () => {
		const windows = [{ percent: 100, resetsAt: session }, { percent: 62, resetsAt: weekly }];
		assert.equal(blockedUntilFromUsage(windows), session.getTime());
	});

	it("uses the latest reset when several windows are exhausted", () => {
		const windows = [{ percent: 100, resetsAt: session }, { percent: 100, resetsAt: weekly }];
		assert.equal(blockedUntilFromUsage(windows), weekly.getTime());
	});

	it("reports nothing when no window is exhausted", () => {
		assert.equal(blockedUntilFromUsage([{ percent: 97, resetsAt: session }]), undefined);
		assert.equal(blockedUntilFromUsage([{ percent: 100, resetsAt: null }]), undefined);
	});
});

describe("blockedUntilFromHeaders", () => {
	it("reads the reset of a rejected subscription request", () => {
		const headers = { "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-reset": "1764100000" };
		assert.equal(blockedUntilFromHeaders(headers), 1_764_100_000_000);
	});

	it("ignores allowed requests and missing resets", () => {
		assert.equal(blockedUntilFromHeaders({ "anthropic-ratelimit-unified-status": "allowed" }), undefined);
		assert.equal(blockedUntilFromHeaders({ "anthropic-ratelimit-unified-status": "rejected" }), undefined);
	});
});
