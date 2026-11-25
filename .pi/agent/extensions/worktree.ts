/**
 * $worktree
 *
 * Tracks the git worktree the agent is working in and exposes it as:
 * - `$worktree` / `${worktree}` in user prompts, including expanded prompt
 *   templates and skills, and in typed extension command arguments
 *   (`/plannotator-review $worktree`);
 * - when no worktree is known, `$worktree` shows in red in the editor and
 *   Enter refuses to submit it;
 * - the `worktree` shell variable in agent bash calls and user `!` commands.
 *
 * Starts at the worktree containing the session cwd. A bash call that changes
 * directory and ends inside a git worktree (`cd ../feat-x && ...`) moves
 * `$worktree` there. `git twig new` moves it to
 * the worktree it created. The value is persisted per session branch, and
 * each change shows a notice in the chat. `/worktree` prints the current one.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CustomEditor, createLocalBashOperations, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, Spacer, Text } from "@earendil-works/pi-tui";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY_TYPE = "worktree";

function displayPath(path: string): string {
  const home = process.env.HOME;
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
const VARIABLE_RE = /\$\{worktree\}|\$worktree\b/g;
const TWIG_NEW_RE = /\bgit\b[^\n;&|]*\btwig\s+new\b/;

function gitOutput(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function worktreeRoot(dir: string): string | undefined {
  return gitOutput(dir, ["rev-parse", "--show-toplevel"]) || undefined;
}

function listWorktrees(dir: string): Set<string> {
  const porcelain = gitOutput(dir, ["worktree", "list", "--porcelain"]) ?? "";
  return new Set(
    porcelain
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length)),
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}


function replaceVariable<T>(content: T, value: string): T {
  if (typeof content === "string") return content.replace(VARIABLE_RE, value) as T;
  if (!Array.isArray(content)) return content;
  return content.map((part) =>
    part?.type === "text" && typeof part.text === "string"
      ? { ...part, text: part.text.replace(VARIABLE_RE, value) }
      : part,
  ) as T;
}

export default function (pi: ExtensionAPI) {
  let worktree: string | undefined;
  const pendingCalls = new Map<string, { pwdFile: string; worktreesBefore?: Set<string> }>();

  // Rendered like pi's own cache-miss notices; custom entries stay out of the model context.
  pi.registerEntryRenderer<{ path?: string }>(ENTRY_TYPE, (entry, _options, theme) => {
    if (!entry.data?.path) return undefined;
    const notice = new Container();
    notice.addChild(new Spacer(1));
    notice.addChild(new Text(theme.fg("dim", `$worktree → ${displayPath(entry.data.path)}`), 1, 0));
    return notice;
  });

  pi.registerCommand("worktree", {
    description: "Show the current $worktree",
    handler: async (_args, ctx) => {
      if (worktree) ctx.ui.notify(`$worktree is ${displayPath(worktree)}`, "info");
      else ctx.ui.notify("$worktree is not defined: this session is not inside a git worktree.", "error");
    },
  });

  function setWorktree(path: string) {
    if (path === worktree) return;
    worktree = path;
    pi.appendEntry(ENTRY_TYPE, { path });
  }

  function restore(ctx: ExtensionContext) {
    const saved = ctx.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "custom" && entry.customType === ENTRY_TYPE)
      .at(-1) as { data?: { path?: string } } | undefined;
    worktree = saved?.data?.path ?? worktreeRoot(ctx.cwd);
  }

  pi.on("session_start", (_event, ctx) => {
    restore(ctx);
    if (ctx.mode !== "tui") return;

    // Keep any editor another extension installed rather than replacing it.
    if (ctx.ui.getEditorComponent()) return;
    const highlight = (m: string) => ctx.ui.theme.fg("error", m);
    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) =>
        new (class extends CustomEditor {
          // Extension commands run before the `input` event, so their arguments
          // are rewritten here, just before Enter submits them.
          handleInput(data: string): void {
            const text = this.getText();
            if (matchesKey(data, Key.enter) && text.search(VARIABLE_RE) !== -1) {
              if (!worktree) {
                ctx.ui.notify("$worktree is not defined: this session is not inside a git worktree.", "error");
                return;
              }
              if (text.startsWith("/")) this.setText(text.replace(VARIABLE_RE, worktree));
            }
            super.handleInput(data);
          }

          render(width: number): string[] {
            const lines = super.render(width);
            return worktree ? lines : lines.map((line) => line.replace(VARIABLE_RE, highlight));
          }
        })(tui, theme, keybindings),
    );
  });
  pi.on("session_tree", (_event, ctx) => restore(ctx));

  pi.on("message_end", (event) => {
    if (!worktree || event.message.role !== "user") return;
    const content = replaceVariable(event.message.content, worktree);
    if (JSON.stringify(content) === JSON.stringify(event.message.content)) return;
    return { message: { ...event.message, content } };
  });

  pi.on("tool_call", (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const pwdFile = join(tmpdir(), `pi-worktree-${process.pid}-${event.toolCallId}`);
    const worktreesBefore = TWIG_NEW_RE.test(event.input.command) ? listWorktrees(ctx.cwd) : undefined;
    pendingCalls.set(event.toolCallId, { pwdFile, worktreesBefore });

    const exportLine = worktree ? `export worktree=${shellQuote(worktree)}\n` : "";
    // cd sets OLDPWD, so it tells a directory change apart from a call that never moved.
    const trap = `trap '[ -n "$OLDPWD" ] && pwd -P > ${shellQuote(pwdFile)}' EXIT`;
    event.input.command = `${exportLine}unset OLDPWD\n${trap}\n${event.input.command}`;
  });

  pi.on("tool_execution_end", (event, ctx) => {
    const pending = pendingCalls.get(event.toolCallId);
    if (!pending) return;
    pendingCalls.delete(event.toolCallId);

    let finalPwd: string | undefined;
    try {
      finalPwd = readFileSync(pending.pwdFile, "utf8").trim() || undefined;
    } catch {}
    rmSync(pending.pwdFile, { force: true });

    if (pending.worktreesBefore) {
      const after = new Set([...listWorktrees(ctx.cwd), ...(finalPwd ? listWorktrees(finalPwd) : [])]);
      const created = [...after].find((path) => !pending.worktreesBefore!.has(path));
      if (created) return setWorktree(created);
    }

    if (finalPwd) {
      const root = worktreeRoot(finalPwd);
      if (root) setWorktree(root);
    }
  });

  pi.on("user_bash", () => {
    if (!worktree) return;
    const local = createLocalBashOperations();
    const exportLine = `export worktree=${shellQuote(worktree)}\n`;
    return {
      operations: {
        exec: (command, cwd, options) => local.exec(exportLine + command, cwd, options),
      },
    };
  });
}
