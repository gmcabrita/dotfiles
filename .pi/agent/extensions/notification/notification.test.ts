import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import registerTerminalNotification from "./index.ts";

type NotificationHandler = (event: { type: string }, ctx: ExtensionContext) => void;

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
    emit(event: string) {
      handlers.get(event)?.({ type: event }, context);
    },
  };
}

test("sends one complete OSC 9 notification when the main TUI session settles", (t) => {
  const { emit, output } = createNotificationHarness(t);
  emit("agent_settled");
  assert.equal(output.mock.callCount(), 1);
  assert.deepEqual(output.mock.calls[0].arguments, ["\x1b]9;Pi is ready for input\x07"]);
});

test("waits for settlement after agent_end, retries, and compaction", (t) => {
  const { emit, output } = createNotificationHarness(t);
  emit("agent_end");
  emit("session_compact");
  emit("agent_end");
  assert.equal(output.mock.callCount(), 0);
  emit("agent_settled");
  assert.equal(output.mock.callCount(), 1);
});

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
    assert.equal(output.mock.callCount(), 0);
  });
}
