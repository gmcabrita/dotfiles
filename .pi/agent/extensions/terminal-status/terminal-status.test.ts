import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import registerTerminalStatus from "./index.ts";

type TerminalStatusHandler = (
  event: { type: string; messages: [] },
  ctx: ExtensionContext,
) => void | Promise<void>;

function createTerminalStatusHarness(t: TestContext) {
  const titles: string[] = [];
  t.mock.timers.enable({ apis: ["setInterval"] });

  const handlers = new Map<string, TerminalStatusHandler[]>();
  registerTerminalStatus({
    on(event: string, handler: TerminalStatusHandler) {
      const callbacks = handlers.get(event) ?? [];
      callbacks.push(handler);
      handlers.set(event, callbacks);
    },
    getSessionName: () => "Test session",
  } as unknown as ExtensionAPI);
  const state = { idle: true };
  const context = {
    cwd: "/tmp/project",
    mode: "tui",
    isIdle: () => state.idle,
    ui: { setTitle: (title: string) => titles.push(title) },
  } as unknown as ExtensionContext;

  async function emit(event: string) {
    // Match Pi's extension runner, including awaits between callbacks.
    for (const handler of handlers.get(event) ?? []) {
      await handler({ type: event, messages: [] }, context);
    }
  }
  t.after(() => emit("session_shutdown"));
  return { emit, titles, state };
}

const IDLE_TITLE = "π · Test session · project";

test("spins while Pi works and restores the idle title when Pi settles", async (t) => {
  const { emit, titles } = createTerminalStatusHarness(t);
  await emit("session_start");
  await emit("agent_start");
  assert.equal(titles.at(-1), `⠋ ${IDLE_TITLE}`);
  t.mock.timers.tick(100);
  assert.equal(titles.at(-1), `⠙ ${IDLE_TITLE}`);

  await emit("agent_end");
  assert.equal(titles.at(-1), `⠙ ${IDLE_TITLE}`);

  titles.length = 0;
  await emit("agent_settled");
  assert.deepEqual(titles, [IDLE_TITLE]);
  t.mock.timers.tick(500);
  assert.deepEqual(titles, [IDLE_TITLE]);
});

test("keeps spinning when work resumes and clears the title at the next settlement", async (t) => {
  const { emit, titles, state } = createTerminalStatusHarness(t);
  await emit("session_start");
  await emit("agent_start");
  state.idle = false;
  titles.length = 0;
  await emit("agent_settled");
  assert.deepEqual(titles, []);
  t.mock.timers.tick(100);
  assert.equal(titles.at(-1), `⠙ ${IDLE_TITLE}`);

  state.idle = true;
  titles.length = 0;
  await emit("agent_settled");
  assert.deepEqual(titles, [IDLE_TITLE]);
  t.mock.timers.tick(500);
  assert.deepEqual(titles, [IDLE_TITLE]);
});

test("stops the spinner on shutdown", async (t) => {
  const { emit, titles } = createTerminalStatusHarness(t);
  await emit("session_start");
  await emit("agent_start");
  titles.length = 0;
  await emit("session_shutdown");
  t.mock.timers.tick(500);
  assert.deepEqual(titles, [IDLE_TITLE]);
});
