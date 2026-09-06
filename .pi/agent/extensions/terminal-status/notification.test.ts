import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentEndEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import registerTerminalNotification from "./terminal-notification.ts";
import { formatNotificationText } from "./notification-text.ts";

type NotificationHandler = (event: { type: string; messages: AgentEndEvent["messages"] }, ctx: ExtensionContext) => void;

function assistantResponse(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return {
    role: "assistant", content, stopReason,
    api: "anthropic-messages", provider: "anthropic", model: "test", timestamp: 0,
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

type NotificationTestOptions = {
  mode?: ExtensionContext["mode"];
  hasUI?: boolean;
  isTTY?: boolean;
  child?: boolean;
  parentSession?: string;
  pending?: boolean;
  idle?: boolean;
};

function createNotificationHarness(t: TestContext, options: NotificationTestOptions = {}) {
  const previousChild = process.env.PI_TMUX_SUBAGENT_CHILD;
  const previousTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  t.after(() => {
    if (previousChild === undefined) delete process.env.PI_TMUX_SUBAGENT_CHILD;
    else process.env.PI_TMUX_SUBAGENT_CHILD = previousChild;
    if (previousTTY) Object.defineProperty(process.stdout, "isTTY", previousTTY);
    else Reflect.deleteProperty(process.stdout, "isTTY");
  });
  process.env.PI_TMUX_SUBAGENT_CHILD = options.child ? "1" : "0";
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: options.isTTY ?? true,
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const output = t.mock.method(process.stdout, "write", () => true);
  const handlers = new Map<string, NotificationHandler>();
  registerTerminalNotification({
    on(event: string, handler: NotificationHandler) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI);
  const context = {
    mode: options.mode ?? "tui",
    hasUI: options.hasUI ?? true,
    isIdle: () => options.idle ?? true,
    hasPendingMessages: () => options.pending ?? false,
    sessionManager: {
      getHeader: () => ({ parentSession: options.parentSession }),
    },
  } as unknown as ExtensionContext;

  return {
    output,
    emit(event: string, messages: AgentEndEvent["messages"] = []) {
      handlers.get(event)?.({ type: event, messages }, context);
    },
  };
}

test("sends one complete OSC 9 notification when the main TUI session settles", (t) => {
  const { emit, output } = createNotificationHarness(t);
  emit("agent_end", [assistantResponse([{ type: "text", text: "Tests passed.\nAll done." }])]);
  emit("agent_settled");
  assert.equal(output.mock.callCount(), 0);
  t.mock.timers.tick(99);
  assert.equal(output.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.equal(output.mock.callCount(), 1);
  assert.deepEqual(output.mock.calls[0].arguments, ["\x1b]9;Tests passed. All done.\x07"]);
});

test("waits for settlement after agent_end, retries, and compaction", (t) => {
  const { emit, output } = createNotificationHarness(t);
  emit("agent_end");
  emit("session_compact");
  emit("agent_end");
  assert.equal(output.mock.callCount(), 0);
  emit("agent_settled");
  t.mock.timers.tick(100);
  assert.equal(output.mock.callCount(), 1);
});

test("uses only text blocks from the last assistant response", (t) => {
  const { emit, output } = createNotificationHarness(t);
  emit("agent_end", [
    assistantResponse([{ type: "text", text: "Earlier response" }]),
    assistantResponse([
      { type: "thinking", thinking: "Private reasoning" },
      { type: "text", text: "Done." },
      { type: "toolCall", id: "call", name: "bash", arguments: { command: "secret" } },
      { type: "text", text: "Tests passed." },
    ]),
    { role: "user", content: "User text", timestamp: 0 },
    { role: "toolResult", toolCallId: "call", toolName: "bash", content: [{ type: "text", text: "Tool output" }], isError: false, timestamp: 0 },
  ]);
  emit("agent_settled");
  t.mock.timers.tick(100);
  assert.deepEqual(output.mock.calls[0].arguments, ["\x1b]9;Done. Tests passed.\x07"]);
});

test("uses the final run after retries, compaction, and queued work", (t) => {
  const { emit, output } = createNotificationHarness(t);
  for (const text of ["Retry", "First answer", "Final answer"]) {
    emit("agent_start");
    emit("agent_end", [assistantResponse([{ type: "text", text }])]);
    emit("session_compact");
  }
  assert.equal(output.mock.callCount(), 0);
  emit("agent_settled");
  t.mock.timers.tick(100);
  assert.deepEqual(output.mock.calls[0].arguments, ["\x1b]9;Final answer\x07"]);
});

for (const resetEvent of ["agent_start", "session_start", "agent_end"]) {
  test(`clears stale response text on ${resetEvent}`, (t) => {
    const { emit, output } = createNotificationHarness(t);
    emit("agent_end", [assistantResponse([{ type: "text", text: "Old response" }])]);
    emit(resetEvent);
    emit("agent_settled");
    t.mock.timers.tick(100);
    assert.deepEqual(output.mock.calls[0].arguments, ["\x1b]9;Pi is ready for input\x07"]);
  });
}

for (const stopReason of ["stop", "error", "aborted"] as const) {
  test(`uses fallback for an empty ${stopReason} response`, (t) => {
    const { emit, output } = createNotificationHarness(t);
    emit("agent_end", [
      assistantResponse([{ type: "text", text: "Old response" }]),
      assistantResponse([{ type: "thinking", thinking: "Private reasoning" }], stopReason),
    ]);
    emit("agent_settled");
    t.mock.timers.tick(100);
    assert.deepEqual(output.mock.calls[0].arguments, ["\x1b]9;Pi is ready for input\x07"]);
  });
}

for (const event of ["agent_start", "session_start", "session_shutdown"]) {
  test(`cancels a delayed notification on ${event}`, (t) => {
    const { emit, output } = createNotificationHarness(t);
    emit("agent_settled");
    t.mock.timers.tick(50);
    emit(event);
    t.mock.timers.tick(100);
    assert.equal(output.mock.callCount(), 0);
  });
}

for (const [name, change] of [
  ["new work", { idle: false }],
  ["queued messages", { pending: true }],
  ["session fork", { parentSession: "/tmp/parent.jsonl" }],
] satisfies [string, NotificationTestOptions][]) {
  test(`suppresses delayed notification after ${name}`, (t) => {
    const options: NotificationTestOptions = {};
    const { emit, output } = createNotificationHarness(t, options);
    emit("agent_settled");
    Object.assign(options, change);
    t.mock.timers.tick(100);
    assert.equal(output.mock.callCount(), 0);
  });
}

test("replaces a pending notification after another settlement", (t) => {
  const { emit, output } = createNotificationHarness(t);
  emit("agent_end", [assistantResponse([{ type: "text", text: "Old response" }])]);
  emit("agent_settled");
  t.mock.timers.tick(50);
  emit("agent_end", [assistantResponse([{ type: "text", text: "New response" }])]);
  emit("agent_settled");
  t.mock.timers.tick(50);
  assert.equal(output.mock.callCount(), 0);
  t.mock.timers.tick(50);
  assert.deepEqual(output.mock.calls[0].arguments, ["\x1b]9;New response\x07"]);
  t.mock.timers.tick(100);
  assert.equal(output.mock.callCount(), 1);
});

const formattingCases: [string, string, string][] = [
  ["whitespace", "  First\r\n\t second\n\nthird\u2028fourth\u2029fifth\u00a0  ", "First second third fourth fifth"],
  ["ANSI styling", "\x1b[31mDone\x1b[0m", "Done"],
  ["terminal controls", "A\x00\x07\x1b\x7f\x9cB", "AB"],
  ["OSC injection", "Done\x07\x1b]9;Injected\x07", "Done"],
  ["OSC hyperlink", "\x1b]8;;https://example.com\x07Link\x1b]8;;\x07", "Link"],
  ["empty text", "\n\t\x07", "Pi is ready for input"],
  ["ConEmu subcommand", "4;1;50", " 4;1;50"],
  ["ConEmu wait command", "5", " 5"],
  ["ConEmu keyboard command", "10", " 10"],
  ["ConEmu prompt command", "12", " 12"],
  ["ConEmu command after cleanup", "\n\x1b[31m4;1;50\x1b[0m", " 4;1;50"],
  ["ordinary number", "42 tests passed", " 42 tests passed"],
  ["number after text", "Passed 42 tests", "Passed 42 tests"],
  ["digit prefix at character limit", "4".repeat(201), ` ${"4".repeat(199)}…`],
  ["digit prefix at byte limit", "4;" + "a" + "\u0301".repeat(1022), " 4;…"],
  ["exact character limit", "a".repeat(200), "a".repeat(200)],
  ["long text", "a".repeat(201), `${"a".repeat(199)}…`],
  ["emoji", "😀".repeat(201), `${"😀".repeat(199)}…`],
  ["combining marks", "e\u0301".repeat(201), `${"e\u0301".repeat(199)}…`],
  ["emoji byte limit", "👨‍👩‍👧‍👦".repeat(200), `${"👨‍👩‍👧‍👦".repeat(81)}…`],
  ["one oversized grapheme", "e" + "\u0301".repeat(1100), "…"],
  ["exact byte limit", "a" + "\u0301".repeat(1023), "a" + "\u0301".repeat(1023)],
  ["ellipsis byte budget", "a" + "\u0301".repeat(1023) + "b", "…"],
];

for (const [name, response, expected] of formattingCases) {
  test(`formats notification text: ${name}`, () => {
    const actual = formatNotificationText(response);
    assert.equal(actual, expected);
    assert.ok(Buffer.byteLength(actual) <= 2047);
    assert.doesNotMatch(actual, /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u);
  });
}

const suppressedCases: [string, NotificationTestOptions][] = [
  ["tmux subagent", { child: true }],
  ["forked session", { parentSession: "/tmp/parent.jsonl" }],
  ["RPC mode with UI", { mode: "rpc", hasUI: true }],
  ["JSON mode", { mode: "json", hasUI: false }],
  ["print mode", { mode: "print", hasUI: false }],
  ["session without UI", { hasUI: false }],
  ["redirected stdout", { isTTY: false }],
  ["queued messages", { pending: true }],
  ["another extension started work", { idle: false }],
];

for (const [name, options] of suppressedCases) {
  test(`does not send a notification for ${name}`, (t) => {
    const { emit, output } = createNotificationHarness(t, options);
    emit("agent_settled");
    t.mock.timers.tick(100);
    assert.equal(output.mock.callCount(), 0);
  });
}
