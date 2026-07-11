import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  CONTINUE_COMMAND_DESCRIPTION,
  getLastAssistantMessageText,
} from "./src/index.js";

/**
 * pi-invisible-continue — resume the agentic loop without the LLM seeing any new prompt.
 *
 * Strategy:
 *   - Monkey-patch Agent.prototype.subscribe to capture the Agent instance
 *   - /continue calls agent.prompt([]) directly, starting a fresh agent loop
 *     with an empty prompt — no message is injected into context at all
 *   - The LLM receives the exact same message list it had before
 *   - No session JSONL artifact, no convertToLlm involvement, no filter needed
 *
 * This bypasses AgentSession._runAgentPrompt, so auto-compaction is not
 * triggered after a manual /continue. Auto-retry is not a concern — pi-retry
 * covers that gap via its agent_end handler, which still fires because the
 * agent's processEvents propagates to AgentSession's subscriber normally.
 *
 * Module resolution:
 *   The Agent class is imported from @earendil-works/pi-agent-core.
 *   This package does NOT list pi-agent-core as a devDependency — there is
 *   no local node_modules copy. When jiti loads this extension, its alias
 *   system rewrites the import specifier to pi's bundled copy, so the
 *   subscribe/continue patches apply to the SAME Agent class that
 *   AgentSession uses. Previously, a local node_modules/@earendil-works/pi-agent-core
 *   caused jiti to resolve the import to a different class — patching the
 *   wrong prototype and leaving _agent permanently null.
 */

// Capture the live Agent instance when AgentSession subscribes to it.
// subscribe() is called during AgentSession construction — fires on both
// fresh sessions and session resumes, unlike prompt().
//
// Chain the previous patch (if pi-retry or pi-vcc already patched it)
// so all extensions can coexist.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _agent: Agent | null = null;
const _origSubscribe = Agent.prototype.subscribe as (this: Agent, ...args: any[]) => any;
Agent.prototype.subscribe = function (this: Agent, ...args: any[]) {
  _agent = this;
  return _origSubscribe.apply(this, args);
};

// Mutex: only one invisible continue may be in-flight at a time.
// Without this, concurrent /continue (or /continue during pi-retry/pi-vcc
// auto-continuation) race through waitForIdle() and both call prompt([]),
// producing "Agent is already processing".
let _continueInProgress = false;

// Timestamp of the last completed invisible continue.
// Used to avoid double continuation when continue() unblocks after
// triggerInvisibleContinue just ran.
let _lastInvisibleContinueTime = 0;

// Monkey-patch continue() so the session's built-in loop cooperates with
// our mutex AND can convert the "Cannot continue from assistant" error
// into a prompt([]) call when the agent was mid-task.
// Without this, the session's continue() would throw when the last message
// is an assistant (common after compaction), and the agent loop would die
// leaving mid-task work unfinished.
//
// Note (pi 0.79+): Agent.continue() now drains queued steering/follow-up
// messages before throwing, so this throw path only fires when there are
// genuinely no queued messages — the prompt([]) fallback is still correct.
//
// When continue() throws "Cannot continue from message role: assistant":
// - stopReason "stop" → agent finished cleanly, don't continue
// - stopReason "aborted" → user cancelled, don't continue
// - stopReason "error" → pi-retry handles errors, don't race it
// - stopReason "toolUse" or "length" → mid-task, fall back to prompt([])
//
// Chains the previous patch (pi-retry, pi-vcc) so all mutexes are respected.
const _origContinue = Agent.prototype.continue;
Agent.prototype.continue = function (this: Agent) {
  const self = this;
  return (async (): Promise<void> => {
    while (_continueInProgress) {
      await new Promise(r => setTimeout(r, 10));
    }
    try {
      await _origContinue.call(self);
    } catch (e: any) {
      const msg = e?.message ?? '';
      if (msg.includes('Cannot continue from message role') ||
          msg.includes('Cannot continue from an assistant message')) {
        // Check stopReason — only continue if the agent was mid-task
        const lastMsg = self.state.messages[self.state.messages.length - 1];
        if (lastMsg?.role === 'assistant' &&
            lastMsg.stopReason !== 'stop' &&
            lastMsg.stopReason !== 'aborted' &&
            lastMsg.stopReason !== 'error') {
          // Agent was mid-task — fall back to prompt([])
          // Guard: if an invisible continue just completed, don't double-run
          if (!_continueInProgress && Date.now() - _lastInvisibleContinueTime > 500) {
            _continueInProgress = true;
            try {
              await self.prompt([]);
            } catch {
              // Agent already processing or other transient error
            } finally {
              _continueInProgress = false;
            }
          }
        }
        // For stop/aborted/error: return void, the session loop exits naturally
        return;
      }
      if (msg.includes('Agent is already processing')) {
        return;
      }
      throw e;
    }
  })();
};

export default function (pi: ExtensionAPI) {
  pi.registerCommand("continue", {
    description: CONTINUE_COMMAND_DESCRIPTION,
    handler: async (args, ctx) => {
      await runContinueCommand(ctx, args);
    },
  });

  pi.on("session_start", () => {
    _continueInProgress = false;
    _lastInvisibleContinueTime = 0;
  });
}

async function runContinueCommand(
  ctx: ExtensionCommandContext,
  args: string,
): Promise<void> {
  if (args.trim().toLowerCase() === "status") {
    const last = getLastAssistantMessageText(ctx.sessionManager.getEntries());
    const idle = ctx.isIdle();
    ctx.ui.notify(
      [
        "pi-invisible-continue status:",
        `  Agent idle: ${idle ? "yes" : "no"}`,
        `  Captured agent: ${_agent ? "yes" : "no"}`,
        `  Last assistant: ${last ?? "(none)"}`.slice(0, 120),
      ].join("\n"),
      "info",
    );
    return;
  }

  if (args.trim().toLowerCase() === "help") {
    ctx.ui.notify(
      [
        "pi-invisible-continue  /continue     Resume loop invisibly",
        "                        /continue status  Show diagnostics",
        "                        /continue help    This message",
      ].join("\n"),
      "info",
    );
    return;
  }

  if (!_agent) {
    ctx.ui.notify(
      "pi-invisible-continue: Agent instance not captured. Internal error?",
      "warning",
    );
    return;
  }

  if (!ctx.isIdle()) {
    await ctx.waitForIdle();
  }

  // Guard: if pi-retry or pi-vcc already has an invisible continue in-flight,
  // skip — their prompt([]) will resume the loop.
  if (_continueInProgress) {
    ctx.ui.notify(
      "pi-invisible-continue: Another invisible continue is already in progress.",
      "info",
    );
    return;
  }
  _continueInProgress = true;

  try {
    await _agent.waitForIdle();
    try {
      await _agent.prompt([]);
    } catch {
      // Agent is already processing — something else is driving.
    }
  } finally {
    _continueInProgress = false;
    _lastInvisibleContinueTime = Date.now();
  }
}
