import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import registerTerminalStatus from "./index.ts";

type TerminalStatusHandler = (
  event: { type: string; messages: [] },
  ctx: ExtensionContext,
) => void | Promise<void>;

function createTerminalStatusHarness(t: TestContext) {
  const previousChild = process.env.PI_TMUX_SUBAGENT_CHILD;
  const previousTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  t.after(() => {
    if (previousChild === undefined) delete process.env.PI_TMUX_SUBAGENT_CHILD;
    else process.env.PI_TMUX_SUBAGENT_CHILD = previousChild;
    if (previousTTY) Object.defineProperty(process.stdout, "isTTY", previousTTY);
    else Reflect.deleteProperty(process.stdout, "isTTY");
  });
  process.env.PI_TMUX_SUBAGENT_CHILD = "0";
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  const writes: string[] = [];
  const terminal = { title: "", notificationTitles: [] as string[] };
  let titleTimer: ReturnType<typeof setTimeout> | undefined;
  t.mock.method(process.stdout, "write", (text: string) => {
    writes.push(text);
    if (text.startsWith("\x1b]9;")) terminal.notificationTitles.push(terminal.title);
    return true;
  });
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });

  const handlers = new Map<string, TerminalStatusHandler[]>();
  registerTerminalStatus({
    on(event: string, handler: TerminalStatusHandler) {
      const callbacks = handlers.get(event) ?? [];
      callbacks.push(handler);
      handlers.set(event, callbacks);
    },
    getSessionName: () => "Test session",
  } as unknown as ExtensionAPI);
  const state = { idle: true, pending: false };
  const context = {
    cwd: "/tmp/project",
    mode: "tui",
    hasUI: true,
    isIdle: () => state.idle,
    hasPendingMessages: () => state.pending,
    sessionManager: { getHeader: () => ({}) },
    ui: {
      setTitle: (title: string) => {
        process.stdout.write(`\x1b]0;${title}\x07`);
        // Ghostty delays title display by 75 ms and cancels earlier updates.
        if (titleTimer !== undefined) clearTimeout(titleTimer);
        titleTimer = setTimeout(() => { terminal.title = title; }, 75);
      },
    },
  } as unknown as ExtensionContext;

  async function emit(event: string) {
    // Match Pi's extension runner, including awaits between callbacks.
    for (const handler of handlers.get(event) ?? []) {
      await handler({ type: event, messages: [] }, context);
    }
  }
  t.after(() => emit("session_shutdown"));
  return { emit, writes, state, terminal };
}

const IDLE_TITLE = "\x1b]0;π · Test session · project\x07";
const READY_NOTIFICATION = "\x1b]9;Pi is ready for input\x07";

test("waits for Ghostty to apply the idle title before sending the notification", async (t) => {
  const { emit, writes, terminal } = createTerminalStatusHarness(t);
  await emit("session_start");
  await emit("agent_start");
  t.mock.timers.tick(75);
  assert.match(terminal.title, /^⠋ /u);
  await emit("agent_end");
  assert.ok(writes.every((text) => !text.startsWith("\x1b]9;")));

  writes.length = 0;
  await emit("agent_settled");
  assert.deepEqual(writes, [IDLE_TITLE]);
  t.mock.timers.tick(74);
  assert.match(terminal.title, /^⠋ /u);
  t.mock.timers.tick(1);
  assert.equal(terminal.title, "π · Test session · project");
  assert.deepEqual(terminal.notificationTitles, []);
  t.mock.timers.tick(25);
  assert.deepEqual(writes, [IDLE_TITLE, READY_NOTIFICATION]);
  assert.deepEqual(terminal.notificationTitles, ["π · Test session · project"]);
  t.mock.timers.tick(500);
  assert.deepEqual(writes, [IDLE_TITLE, READY_NOTIFICATION]);
});

test("keeps spinning when work resumes and clears the title at the next settlement", async (t) => {
  const { emit, writes, state } = createTerminalStatusHarness(t);
  await emit("session_start");
  await emit("agent_start");
  state.idle = false;
  writes.length = 0;
  await emit("agent_settled");
  assert.deepEqual(writes, []);
  t.mock.timers.tick(100);
  assert.match(writes.at(-1)!, /^\x1b\]0;⠙ /u);

  state.idle = true;
  writes.length = 0;
  await emit("agent_settled");
  assert.deepEqual(writes, [IDLE_TITLE]);
  t.mock.timers.tick(100);
  assert.deepEqual(writes, [IDLE_TITLE, READY_NOTIFICATION]);
  t.mock.timers.tick(500);
  assert.deepEqual(writes, [IDLE_TITLE, READY_NOTIFICATION]);
});

test("cancels the delayed notification when the spinner restarts", async (t) => {
  const { emit, terminal } = createTerminalStatusHarness(t);
  await emit("session_start");
  await emit("agent_start");
  await emit("agent_settled");
  t.mock.timers.tick(50);
  await emit("agent_start");
  t.mock.timers.tick(100);
  assert.deepEqual(terminal.notificationTitles, []);
});

test("stops the spinner on shutdown without sending a notification", async (t) => {
  const { emit, writes } = createTerminalStatusHarness(t);
  await emit("session_start");
  await emit("agent_start");
  writes.length = 0;
  await emit("session_shutdown");
  t.mock.timers.tick(500);
  assert.deepEqual(writes, [IDLE_TITLE]);
});
