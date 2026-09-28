// Checks that Pi 0.87 context edits reach requests that this extension rewrites.
// Pi omits failed retry attempts and abandoned overflow attempts with
// `context_edit` entries. After a remote compaction, this extension replaces the
// request `input` with its own history, so it must honor the same omissions.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Model, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import openAICodexCompactionExtension from "./index.ts";
import { buildRemoteCompactionDetails } from "./remote-compaction.ts";

const lbModel: Model<any> = {
  id: "gpt-5.6-sol",
  name: "GPT-5.6 Sol",
  provider: "openai-codex-lb",
  api: "openai-codex-lb-responses",
  baseUrl: "http://127.0.0.1/backend-api",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 32_000,
};

type Handler = (event: unknown, ctx: unknown) => unknown;

function user(text: string): UserMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: lbModel.api,
    provider: lbModel.provider,
    model: lbModel.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function toolResult(toolCallId: string, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "bash",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  };
}

function createHarness() {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  } as unknown as ExtensionAPI;
  openAICodexCompactionExtension(pi);

  const sessionManager = SessionManager.inMemory("/tmp");
  const ctx = { model: lbModel, sessionManager };

  async function emit(event: string, payload: unknown = {}): Promise<unknown> {
    let result: unknown;
    for (const handler of handlers.get(event) ?? []) {
      result = (await handler({ type: event, ...(payload as object) }, ctx)) ?? result;
    }
    return result;
  }

  // Mirrors AgentSession: emit message_end, then persist the message.
  async function appendMessage(message: UserMessage | AssistantMessage | ToolResultMessage): Promise<string> {
    await emit("message_end", { message });
    return sessionManager.appendMessage(message);
  }

  // Returns the rewritten payload, or undefined when Pi's payload is kept.
  async function request(): Promise<unknown> {
    return emit("before_provider_request", {
      payload: { model: lbModel.id, input: [], stream: true },
    });
  }

  // Returns the text that the extension sends in the rewritten request.
  async function requestText(): Promise<string> {
    const patched = await request();
    assert.ok(patched, "extension did not rewrite the request");
    return JSON.stringify((patched as { input: unknown }).input);
  }

  function piContextText(): string {
    return JSON.stringify(sessionManager.buildSessionContext().messages);
  }

  // Returns the ID of the old answer, which the compaction keeps.
  async function seedRemoteCompaction(): Promise<string> {
    await appendMessage(user("old request"));
    const keptId = await appendMessage(assistant([{ type: "text", text: "old answer" }], "stop"));
    sessionManager.appendCompaction(
      "summary",
      keptId,
      1_000,
      buildRemoteCompactionDetails(lbModel, [
        { type: "compaction", encrypted_content: "REMOTE_SUMMARY" },
      ]),
    );
    await emit("session_start");
    return keptId;
  }

  return { sessionManager, emit, appendMessage, request, requestText, piContextText, seedRemoteCompaction };
}

test("omits a failed retry attempt from the live remote history", async () => {
  const h = createHarness();
  await h.seedRemoteCompaction();

  await h.appendMessage(user("new request"));
  const failedId = await h.appendMessage(
    assistant([{ type: "text", text: "PARTIAL_FAILED_ATTEMPT" }], "error"),
  );
  h.sessionManager.appendContextEdit(failedId, null);

  assert.doesNotMatch(h.piContextText(), /PARTIAL_FAILED_ATTEMPT/);
  assert.doesNotMatch(await h.requestText(), /PARTIAL_FAILED_ATTEMPT/);
});

test("omits a failed retry attempt after the session reloads", async () => {
  const h = createHarness();
  await h.seedRemoteCompaction();

  await h.appendMessage(user("new request"));
  const failedId = await h.appendMessage(
    assistant([{ type: "text", text: "PARTIAL_FAILED_ATTEMPT" }], "error"),
  );
  h.sessionManager.appendContextEdit(failedId, null);
  await h.emit("session_start");

  const text = await h.requestText();
  assert.match(text, /new request/);
  assert.doesNotMatch(text, /PARTIAL_FAILED_ATTEMPT/);
});

test("omits an abandoned tool call and its result", async () => {
  const h = createHarness();
  await h.seedRemoteCompaction();

  await h.appendMessage(user("new request"));
  const assistantId = await h.appendMessage(
    assistant(
      [{ type: "toolCall", id: "call_1|fc_1", name: "bash", arguments: { command: "ABANDONED_CALL" } }],
      "toolUse",
    ),
  );
  const resultId = await h.appendMessage(toolResult("call_1|fc_1", "ABANDONED_RESULT"));
  h.sessionManager.appendContextEdit(assistantId, null);
  h.sessionManager.appendContextEdit(resultId, null);

  assert.doesNotMatch(h.piContextText(), /ABANDONED_/);
  assert.doesNotMatch(await h.requestText(), /ABANDONED_/);
});

test("applies a content replacement edit", async () => {
  const h = createHarness();
  await h.seedRemoteCompaction();

  await h.appendMessage(user("new request"));
  const answerId = await h.appendMessage(
    assistant([{ type: "text", text: "ORIGINAL_ANSWER" }], "stop"),
  );
  h.sessionManager.appendContextEdit(answerId, { content: "EDITED_ANSWER" });

  const text = await h.requestText();
  assert.match(h.piContextText(), /EDITED_ANSWER/);
  assert.match(text, /EDITED_ANSWER/);
  assert.doesNotMatch(text, /ORIGINAL_ANSWER/);
});

test("sends the turn in progress after a session reload", async () => {
  const h = createHarness();
  await h.seedRemoteCompaction();

  await h.appendMessage(user("NEW_PROMPT"));
  await h.appendMessage(
    assistant(
      [{ type: "toolCall", id: "call_2|fc_2", name: "bash", arguments: { command: "ls" } }],
      "toolUse",
    ),
  );
  await h.appendMessage(toolResult("call_2|fc_2", "PENDING_TOOL_RESULT"));
  await h.emit("session_start");

  const text = await h.requestText();
  assert.match(text, /REMOTE_SUMMARY.*NEW_PROMPT.*PENDING_TOOL_RESULT/);
});

test("keeps Pi's payload when an edit targets a message before the compaction", async () => {
  const h = createHarness();
  const keptId = await h.seedRemoteCompaction();

  await h.appendMessage(user("new request"));
  h.sessionManager.appendContextEdit(keptId, { content: "EDITED_KEPT_ANSWER" });

  assert.match(h.piContextText(), /EDITED_KEPT_ANSWER/);
  assert.equal(await h.request(), undefined);
});
