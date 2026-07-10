import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { loadOpenAICodexLbAdapter, resolveCodexAdapterUrl } from "./clone.ts";
import { API_ID, findCodexLbApiKey, normalizeBaseUrl, PROVIDER_ID, resolveApiKeyConfig } from "./index.ts";
import { loadOpenAICodexModels } from "./models.ts";
import { CODEX_LB_PATCH_MARKER, patchOpenAICodexAdapter } from "./patch.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => reject(error);
		server.once("error", onError);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", onError);
			resolve();
		});
	});

	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP address");
	return address.port;
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

test("patches a separate, fail-closed Codex adapter instance", async () => {
	const sourceUrl = resolveCodexAdapterUrl();
	const source = readFileSync(fileURLToPath(sourceUrl), "utf8");
	const patched = patchOpenAICodexAdapter(source);

	assert.match(patched, new RegExp(`export const ${CODEX_LB_PATCH_MARKER} = true`));
	assert.match(source, /const accountId = extractAccountId\(apiKey\);/);
	assert.doesNotMatch(source, new RegExp(CODEX_LB_PATCH_MARKER));
	assert.throws(
		() => patchOpenAICodexAdapter(source.replace("const accountId = extractAccountId(apiKey);", "")),
		/expected one source match, found 0/,
	);

	const clone = await loadOpenAICodexLbAdapter({ sourceUrl });
	const original: unknown = await import(sourceUrl.href);
	assert.ok(isRecord(original));
	assert.equal(original[CODEX_LB_PATCH_MARKER], undefined);
	assert.notEqual(original.streamSimple, clone.streamSimple);
});

test("loads the Codex model catalog beside the cloned runtime adapter", async () => {
	const models = await loadOpenAICodexModels(resolveCodexAdapterUrl());
	assert.ok(models.length > 0);
	assert.ok(models.every((model) => model.reasoning));
});

test("uses the codex-lb bearer key without a ChatGPT account header", { timeout: 10_000 }, async () => {
	type CapturedRequest = Readonly<{
		url: string | undefined;
		authorization: string | undefined;
		accountId: string | undefined;
	}>;

	let captureRequest: ((request: CapturedRequest) => void) | undefined;
	const requestCaptured = new Promise<CapturedRequest>((resolve) => {
		captureRequest = resolve;
	});
	const server = createServer((request, response) => {
		captureRequest?.({
			url: request.url,
			authorization: request.headers.authorization,
			accountId: firstHeader(request.headers["chatgpt-account-id"]),
		});
		response.writeHead(401, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: { message: "expected test rejection" } }));
	});
	const port = await listen(server);

	try {
		const adapter = await loadOpenAICodexLbAdapter();
		const model: Model<Api> = {
			id: "gpt-5.4",
			name: "GPT-5.4",
			api: API_ID,
			provider: PROVIDER_ID,
			baseUrl: `http://127.0.0.1:${port}/backend-api`,
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 4_096,
		};
		const context: Context = {
			messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
		};

		const stream = adapter.streamSimple(model, context, {
			apiKey: "sk-clb-test-key",
			maxRetries: 0,
			transport: "sse",
		});
		for await (const _event of stream) {
			// Consume the stream so the request and error paths finish.
		}

		const captured = await Promise.race([
			requestCaptured,
			delay(2_000).then(() => {
				throw new Error("Codex LB adapter did not make a request");
			}),
		]);
		assert.equal(captured.url, "/backend-api/codex/responses");
		assert.equal(captured.authorization, "Bearer sk-clb-test-key");
		assert.equal(captured.accountId, undefined);
	} finally {
		await close(server);
	}
});

test("resolves API key and base URL configuration safely", () => {
	assert.equal(
		findCodexLbApiKey({ openai: { type: "api_key", key: "sk-clb-example" } }),
		"sk-clb-example",
	);
	assert.equal(findCodexLbApiKey({ openai: { type: "api_key", key: "sk-openai" } }), undefined);
	assert.equal(
		resolveApiKeyConfig("/path/that/does/not/exist", { CODEX_LB_API_KEY: "sk-clb-from-env" }),
		"$CODEX_LB_API_KEY",
	);
	assert.equal(
		normalizeBaseUrl("http://codexlb.example:2455/backend-api/"),
		"http://codexlb.example:2455/backend-api",
	);
	assert.throws(() => normalizeBaseUrl("http://codexlb.example:2455/v1"), /backend-api Codex route/);
});
