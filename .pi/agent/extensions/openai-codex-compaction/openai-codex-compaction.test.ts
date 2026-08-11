import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import type { Model } from "@earendil-works/pi-ai";
import {
  applyRemoteHistoryPayloadPatch,
  isOpenAICodexLbModel,
  isOpenAICodexModel,
  isSupportedCodexModel,
  thinkingLevelToResponsesReasoning,
} from "./model.ts";
import {
  buildRemoteCompactionDetails,
  buildRemoteCompactionHeaders,
  callRemoteCompactionEndpoint,
  reconstructRemoteCompactionStateFromBranch,
  remoteCompactionV2EndpointUrl,
} from "./remote-compaction.ts";

function model(
  provider: string,
  api: string,
  baseUrl: string,
): Model<any> {
  return {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    provider,
    api,
    baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 32_000,
  };
}

const lbModel = model(
  "openai-codex-lb",
  "openai-codex-lb-responses",
  "http://127.0.0.1/backend-api",
);
const codexModel = model(
  "openai-codex",
  "openai-codex-responses",
  "https://chatgpt.com/backend-api",
);

test("targets only OpenAI Codex providers", () => {
  assert.equal(isOpenAICodexModel(codexModel), true);
  assert.equal(isOpenAICodexLbModel(lbModel), true);
  assert.equal(
    isSupportedCodexModel(model("openai", "openai-responses", "https://api.openai.com/v1")),
    false,
  );
  assert.equal(
    isSupportedCodexModel(model("openai-codex", "openai-responses", "https://chatgpt.com/backend-api")),
    false,
  );
});

test("uses Codex response routes and provider-specific account headers", () => {
  assert.equal(
    remoteCompactionV2EndpointUrl(codexModel),
    "https://chatgpt.com/backend-api/codex/responses",
  );
  assert.equal(
    remoteCompactionV2EndpointUrl(lbModel),
    "http://127.0.0.1/backend-api/codex/responses/compact",
  );

  const jwtPayload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
    }),
  ).toString("base64url");
  const codexHeaders = buildRemoteCompactionHeaders({
    model: codexModel,
    apiKey: `header.${jwtPayload}.signature`,
    sessionId: "session-123",
  });
  const lbHeaders = buildRemoteCompactionHeaders({
    model: lbModel,
    apiKey: "sk-clb-test",
    sessionId: "session-123",
  });

  assert.equal(codexHeaders["chatgpt-account-id"], "account-123");
  assert.equal(lbHeaders["chatgpt-account-id"], undefined);
  assert.equal(lbHeaders.authorization, "Bearer sk-clb-test");
  assert.equal(lbHeaders["x-codex-beta-features"], "remote_compaction_v2");
  assert.equal(lbHeaders.session_id, "session-123");
  assert.equal(lbHeaders["session-id"], undefined);
  assert.throws(
    () =>
      remoteCompactionV2EndpointUrl({ ...lbModel, baseUrl: undefined } as unknown as Model<any>),
    /requires the model's LB base URL/,
  );
});

test("preserves the max Codex reasoning effort", () => {
  const maxModel = {
    ...codexModel,
    thinkingLevelMap: { max: "max" },
  };
  assert.deepEqual(thinkingLevelToResponsesReasoning(maxModel, "max"), {
    effort: "max",
    summary: "auto",
  });
});

test("replaces normal Codex history only after remote compaction", () => {
  const history = [{ type: "compaction", encrypted_content: "opaque" }] as const;
  assert.deepEqual(
    applyRemoteHistoryPayloadPatch(
      { model: "gpt-5.6-sol", messages: ["old"], previous_response_id: "response-1" },
      [...history],
    ),
    { model: "gpt-5.6-sol", input: history },
  );

  const details = buildRemoteCompactionDetails(codexModel, [...history]);
  const state = reconstructRemoteCompactionStateFromBranch({
    branchEntries: [
      { type: "compaction", id: "compaction-1", details: { remoteCompaction: details } },
      {
        type: "message",
        id: "user-1",
        message: { role: "user", content: "continue", timestamp: 1 },
      },
      {
        type: "message",
        id: "assistant-1",
        message: {
          role: "assistant",
          provider: codexModel.provider,
          model: codexModel.id,
          api: codexModel.api,
          content: [{ type: "text", text: "done" }],
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 2,
        },
      },
    ],
  });

  assert.equal(state?.compactionEntryId, "compaction-1");
  assert.deepEqual(state?.explicitHistory.map((item) => item.type), [
    "compaction",
    "message",
    "message",
  ]);
});

let port = 0;
let requestPath: string | undefined;
let requestBody: Record<string, unknown> | undefined;
let requestHeaders: Record<string, string | string[] | undefined> | undefined;
const server = createServer(async (request, response) => {
  requestPath = request.url;
  requestHeaders = request.headers;
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;

  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    object: "response.compaction",
    output: [{ type: "compaction_summary", encrypted_content: "opaque" }],
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
  }));
});

before(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not expose a port"));
        return;
      }
      port = address.port;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("calls remote compaction for openai-codex-lb without ChatGPT account auth", async () => {
  const testModel = model(
    "openai-codex-lb",
    "openai-codex-lb-responses",
    `http://127.0.0.1:${port}/backend-api`,
  );
  const input = [
    {
      type: "message" as const,
      role: "user",
      content: [{ type: "input_text" as const, text: "keep this" }],
    },
  ];

  const result = await callRemoteCompactionEndpoint({
    model: testModel,
    apiKey: "sk-clb-test",
    sessionId: "session-test",
    input,
    tools: [],
    parallelToolCalls: true,
  });

  assert.equal(requestPath, "/backend-api/codex/responses/compact");
  assert.equal(requestHeaders?.authorization, "Bearer sk-clb-test");
  assert.equal(requestHeaders?.["chatgpt-account-id"], undefined);
  assert.deepEqual(requestBody?.input, input);
  assert.equal(requestBody?.stream, undefined);
  assert.equal(requestBody?.tools, undefined);
  assert.equal(requestBody?.store, false);
  assert.equal(result.output.at(-1)?.type, "compaction");
  assert.equal(result.usage?.totalTokens, 12);
});
