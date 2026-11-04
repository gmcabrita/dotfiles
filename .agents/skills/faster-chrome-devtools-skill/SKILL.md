---
name: faster-chrome-devtools-skill
description: >
  Inspect, debug, and automate Chrome directly through the Chrome DevTools
  Protocol (CDP). Use this skill whenever a task needs a real web browser: open
  a URL, navigate pages, take a screenshot of a web page, read the DOM or
  accessibility tree, click buttons, fill and submit forms, type text, wait for
  elements, scrape page content, evaluate JavaScript on a page, or check console
  errors and failed network requests. Works against the user's local Chrome or a
  remote Cloudflare Browser Rendering endpoint over WebSocket. Relevant to
  browser automation, web scraping, page screenshots, end-to-end UI checks,
  DevTools inspection, and handing cloud browser control to a human for login,
  MFA, CAPTCHA, sensitive input, or approval. No Chrome DevTools MCP, Puppeteer,
  or Playwright required.
compatibility: Requires Node.js 22+
---

# Faster Chrome DevTools: direct CDP

Use the bundled CLI to control Chrome through the Chrome DevTools Protocol
(CDP). It connects directly to Chrome's browser WebSocket with Node.js built-ins.
There is no MCP server, Puppeteer install, Playwright install, or package install.

```sh
node <skill-directory>/scripts/cdp.mjs --help
```

Replace `<skill-directory>` with the directory containing this `SKILL.md`.
Node.js 22 or later is required.

## Before connecting

Local Chrome access exposes the user's open tabs and logged-in browser state.
Obtain the user's approval before inspecting or interacting with their browser.
Ask them to enable remote debugging at `chrome://inspect/#remote-debugging` if it
is not already enabled. Chrome may also show an **Allow debugging** prompt.

For a clean session with no logged-in state, launch a separate anonymous Chrome
locally (see Anonymous local Chrome below) or connect to a remote browser,
instead of using the user's Chrome.

## Connection

The CLI tries these connection methods in order:

1. `--ws-endpoint` or `CDP_WS_ENDPOINT`
2. `--http-endpoint` or `CDP_HTTP_ENDPOINT`, using `/json/version` discovery
3. Chrome's `DevToolsActivePort` file on macOS, Windows, or Linux
4. `http://127.0.0.1:9222/json/version`, or `ws://127.0.0.1:9222/devtools/browser`
   when port 9222 is open but HTTP discovery is disabled

Auto-discovery and an explicit `--ws-endpoint` for the same browser share one
daemon, so prefer plain auto-discovery for local Chrome instead of switching
between styles.

Examples:

```sh
# Discover a local Chrome automatically
node <skill-directory>/scripts/cdp.mjs list

# Discover through an HTTP debugging port
node <skill-directory>/scripts/cdp.mjs \
  --http-endpoint http://127.0.0.1:9222 list

# Connect directly to a local or remote browser WebSocket
node <skill-directory>/scripts/cdp.mjs \
  --ws-endpoint 'wss://browser.example/devtools/browser/...' list

# Authenticated remote endpoint
node <skill-directory>/scripts/cdp.mjs \
  --ws-endpoint "$CDP_WS_ENDPOINT" \
  --headers '{"Authorization":"Bearer ..."}' list
```

Prefer environment variables for secrets so credentials do not enter shell
history:

```sh
export CDP_WS_ENDPOINT='wss://...'
export CDP_HEADERS='{"Authorization":"Bearer ..."}'
node <skill-directory>/scripts/cdp.mjs list
```

### Anonymous local Chrome

To use a clean instance with no logged-in state instead of the user's browser,
launch a separate Chrome with remote debugging on a throwaway profile, then
connect to that port. A non-default `--user-data-dir` is required (Chrome 136+
refuses the debugging port on the default profile) and keeps the instance
isolated from the user's session:

```sh
nohup "$CHROME" --remote-debugging-port=9333 --user-data-dir="$(mktemp -d)" \
  --no-first-run --no-default-browser-check about:blank >/dev/null 2>&1 &
node <skill-directory>/scripts/cdp.mjs --http-endpoint http://127.0.0.1:9333 list
```

`$CHROME` is the Chrome or Chromium binary, for example
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS or
`google-chrome` on Linux. Pick a free port if 9333 is taken. If the browser
exits as soon as the launching command returns, start it detached instead (on
macOS: `open -na "Google Chrome" --args --remote-debugging-port=9333
--user-data-dir=<dir> about:blank`).

A background daemon keeps one browser connection alive for 20 minutes after the
last command. This avoids repeated connection setup and repeated Chrome approval
prompts. On a local connection the first command waits up to two minutes for the
user to click Allow, and prints a notice to stderr while it waits; other
commands started in the meantime reuse that pending connection instead of
showing a second prompt. Stop it explicitly when finished:

```sh
# Stops the daemon when exactly one is running; no browser discovery is needed
node <skill-directory>/scripts/cdp.mjs stop

# Select one when several endpoints have active daemons
node <skill-directory>/scripts/cdp.mjs stop --id <daemon-id>

# Stop only the daemon created for this endpoint, without reconnecting to it
node <skill-directory>/scripts/cdp.mjs \
  --ws-endpoint 'wss://browser.example/devtools/browser/...' stop

# Deliberately stop every daemon
node <skill-directory>/scripts/cdp.mjs stop --all
```

Plain `stop` refuses if multiple daemons are active and prints their safe IDs and
hosts. It never prints endpoint query strings or authentication headers.

## Canonical interaction loop

Start by listing pages. Commands take a unique target ID prefix from this output:

```sh
node <skill-directory>/scripts/cdp.mjs list
node <skill-directory>/scripts/cdp.mjs snapshot <target>
```

Use the accessibility snapshot to inspect page state. Interactive nodes include
stable backend-DOM references such as `ref=123`; pass these as `ref:123`:

```sh
node <skill-directory>/scripts/cdp.mjs click <target> ref:123
node <skill-directory>/scripts/cdp.mjs wait-for <target> text 'Sign in' 5000
node <skill-directory>/scripts/cdp.mjs fill <target> ref:456 'person@example.com'
node <skill-directory>/scripts/cdp.mjs press <target> Enter
node <skill-directory>/scripts/cdp.mjs wait-for <target> text 'Welcome' 10000
```

Standard CSS selectors work when a snapshot ref is unavailable. Playwright-style
selectors such as `text=Close` or `:has-text()` are not supported; find the
element in `snapshot` and use its ref instead:

```sh
node <skill-directory>/scripts/cdp.mjs click <target> 'button[type=submit]'
node <skill-directory>/scripts/cdp.mjs fill <target> 'input[name=email]' 'person@example.com'
```

Confirm every state transition with `wait-for`; do not add arbitrary sleeps.
`wait-for` uses a `MutationObserver` and resolves immediately if the expected text
or selector is already present.

## Command reference

```text
list
open [url]
snapshot <target>
screenshot <target> [file] [--format jpeg|webp|png] [--quality 75] [--full-page]
navigate <target> <url> [timeout-ms]
evaluate <target> <expression>
html <target> [selector]
click <target> <selector|ref:123>
fill <target> <selector|ref:123> <value>
type <target> <text>
press <target> <key>
wait-for <target> <text|selector> <value> [timeout-ms]
live-view <target> [expires-ms]
handoff <target> <instructions> [timeout-ms]
handoff-state <target>
console <target>
failures <target>
raw <target> <CDP.method> [json-params]
stop [--id <daemon-id> | --all]
```

Global options must precede the command:

```text
--ws-endpoint <ws://...>
--http-endpoint <http://...>
--headers <json>
--timeout <ms>
```

Use `type` after focusing an element when JavaScript cannot reach it, such as an
input inside a cross-origin iframe. It uses CDP's `Input.insertText` rather than
DOM evaluation.

`press` takes a single character or a named key (`Enter`, `Tab`, `Escape`,
`Space`, `Backspace`, `Delete`, `Home`, `End`, `PageUp`, `PageDown`, arrow
keys), optionally with `Alt+`, `Control+`, `Meta+`, or `Shift+` modifiers, such
as `Meta+a`, `Shift+Tab`, or `Alt+ArrowDown`. Select-all, copy, cut, paste, and
undo shortcuts trigger the matching editor command.

Use `raw` as an escape hatch for any protocol method:

```sh
node <skill-directory>/scripts/cdp.mjs raw <target> DOM.getDocument '{}'
```

## Snapshot before screenshot

Use `snapshot` to understand or interact with a page. It is faster, produces
text, and provides element references. Use `screenshot` only when visual
appearance matters: CSS rendering, images, canvas, charts, or layout.

Screenshots default to JPEG quality 75 and save to a file, avoiding large inline
base64 payloads. PNG is lossless and often much larger. Full-page images can
still be expensive, so use them only when necessary:

```sh
# Safe default: viewport JPEG at quality 75
node <skill-directory>/scripts/cdp.mjs screenshot <target> /tmp/page.jpg

# Full page, still compressed
node <skill-directory>/scripts/cdp.mjs screenshot <target> /tmp/page.webp \
  --format webp --quality 75 --full-page
```

Avoid full-page PNGs. They commonly reach several megabytes and consume model
context if subsequently attached.

## Navigation and waiting

All protocol calls have a 15-second timeout by default. Set a realistic timeout
for navigation rather than allowing a browser operation to hang:

```sh
node <skill-directory>/scripts/cdp.mjs navigate <target> \
  https://example.com 15000
```

Suggested limits:

| Context | Timeout |
| --- | ---: |
| Local development server | 10,000ms |
| Normal web page | 15,000ms |
| Resource-heavy page | 30,000ms |
| OAuth or external redirect | 60,000ms |

For long `evaluate` or `raw` calls, raise the limit with the global option,
for example `--timeout 60000 evaluate <target> ...`. It applies to that command
only, even when the daemon is already running, so never `stop` the daemon to
change a timeout; restarting it forces a new Chrome approval prompt.

`navigate` waits for `document.readyState === "complete"`. Dynamic application
state may arrive later, so follow navigation with `wait-for` or `snapshot`.

## Debugging

Read captured console output and failed network loads without opening DevTools:

```sh
node <skill-directory>/scripts/cdp.mjs console <target>
node <skill-directory>/scripts/cdp.mjs failures <target>
```

Messages are captured after the daemon first attaches to that page. Reproduce
the problem after running any page command if the initial result is empty.

Use `evaluate` to inspect application state or handle a custom control:

```sh
node <skill-directory>/scripts/cdp.mjs evaluate <target> \
  '({url: location.href, state: document.querySelector(".status")?.dataset.state})'
```

Avoid index-based selectors across separate commands when the DOM can change.
Prefer snapshot refs, stable CSS selectors, or one evaluation that gathers all
required data.

## Troubleshooting

### Browser cannot be found

Enable remote debugging at `chrome://inspect/#remote-debugging`, grant access if
Chrome prompts, then retry once. If Chrome was launched with a specific debug
port, pass `--http-endpoint http://127.0.0.1:<port>`.

Do not repeatedly retry the same connection error; it normally requires a user
action or a corrected endpoint.

### Stale target

Tabs can close or reload into a new target. Run `list` again and use the current
unique prefix.

### Interaction ref no longer resolves

Snapshot refs belong to the current DOM. Take another snapshot after a major
navigation or rerender.

### Custom UI ignores fill or click

Try a stable CSS selector, `evaluate`, or focus with `click` and then use `type`.
Some React controls require their native setter and synthetic `input`/`change`
events; `fill` already performs that sequence for ordinary inputs and textareas.

## Remote Cloudflare Browser Run

The same CLI can connect directly to a Cloudflare Browser Run CDP WebSocket.
Pass the endpoint and authorization headers supplied by that service. No MCP
process is involved.

### Setup

Set the two environment variables the CLI reads, built from your account ID and
an API token, then run any command:

```sh
export CLOUDFLARE_ACCOUNT_ID=<account-id>
export CLOUDFLARE_API_TOKEN=<token>   # needs Browser Rendering: Edit
export CDP_WS_ENDPOINT="wss://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/browser-run/devtools/browser?keep_alive=600000&lab=true"
export CDP_HEADERS="{\"Authorization\":\"Bearer $CLOUDFLARE_API_TOKEN\"}"
node <skill-directory>/scripts/cdp.mjs list
```

When the user asks to use Cloudflare Browser Run, use Browser Run instead of
falling back to local Chrome. If `CDP_WS_ENDPOINT` and `CDP_HEADERS` are not set,
check whether `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are set and
derive the CLI variables from them. If neither pair is available, stop and tell
the user Browser Run cannot start until those variables are set. Do not default
to local Chrome unless the user approves that fallback or explicitly asks for
local browser automation. Never print token values while debugging.

`lab=true` selects Browser Run's experimental Chrome beta pool. Keep it on by
default when using Browser Run so beta browser features, including WebMCP, are
available. Remove `lab=true` only when a stable Chrome pool is more important
than beta feature access, such as production workloads.

`CDP_WS_ENDPOINT` and `CDP_HEADERS` are the only variables the CLI consumes;
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are just inputs used to build
them. Export them per shell session, or source them from a local `.env` (the
dependency-free CLI does not read `.env` itself), rather than passing `--headers`
on the command line where the token is recorded in shell history and process
arguments.

To create the token, open the Cloudflare dashboard, go to Profile > API Tokens,
choose Create Token, pick the Browser Rendering template if offered, or create a
custom token with `Browser Rendering: Edit` scoped to the account. Copy the
secret once. The account ID is shown on the account home page.

If Cloudflare returns `10000 Authentication error`, the token is missing,
invalid, or lacks Browser Rendering access. Ask the user to create a token with
`Browser Rendering: Edit` and set `CLOUDFLARE_API_TOKEN`. Never print token
values.

### Human in the Loop

Use structured handoff when automation reaches MFA, SSO, CAPTCHA, sensitive data
entry, a one-off complex interaction, or an action that requires human approval.
This is available only on Browser Run, not local Chrome.

First generate a Live View URL. Its expiry is 10 minutes by default and should
be at least as long as the planned handoff:

```sh
node <skill-directory>/scripts/cdp.mjs live-view <target> 600000
```

Treat the returned URL as a temporary browser-access credential. Share it only
with the human operator. Ask the operator to open it and confirm they can see the
page before starting the handoff. Then run:

```sh
node <skill-directory>/scripts/cdp.mjs handoff <target> \
  'Please complete MFA, then select Done. Select Failed if you cannot continue.' \
  600000
```

The command subscribes to `Cloudflare.handoffComplete` before calling
`Cloudflare.handoff`, then blocks until the operator selects Done or Failed, or
the handoff times out. The timeout defaults to 10 minutes and cannot exceed
Cloudflare's 30-minute limit. Inspect the JSON result's `success` and `reason`
fields before resuming automation, then run `snapshot` to verify the new page
state. Do not assume success from navigation alone.

If a handoff may already be active, check before starting another:

```sh
node <skill-directory>/scripts/cdp.mjs handoff-state <target>
```

Give specific, actionable instructions that say what to do and when to select
Done or Failed. Human control does not hide Browser Run's bot identity, so some
sites may still block the session. For a manual flow without structured Done or
Failed controls, share `live-view` and use `wait-for` to detect the expected page
state.

### WebMCP and beta browser features

Browser Run lab sessions expose Chrome beta features. WebMCP-enabled sites can
publish structured tools through `document.modelContext`, which can be
faster and less fragile than screenshot, click, and type loops.

After navigating to a page, check whether it exposes WebMCP tools:

```sh
node <skill-directory>/scripts/cdp.mjs evaluate <target> \
  'document.modelContext?.listTools?.() ?? []'
```

When a relevant tool exists, prefer it over DOM interaction and pass parameters
as JSON:

```sh
node <skill-directory>/scripts/cdp.mjs evaluate <target> \
  '(async () => await document.modelContext.executeTool("tool_name", JSON.stringify({})))()'
```

Re-list tools after navigation or a tool call because available tools can change
with page state. Fall back to normal CDP interaction when no relevant WebMCP
tool exists. Some tools can pause for human confirmation before completing
sensitive actions.

Prefer a remote browser when you need a clean anonymous session, CI execution,
or isolation from the user's real browser. Prefer local Chrome when you need the
user's existing login state or are debugging the exact tab they are viewing.

For a single stateless output inside a Cloudflare Worker—such as a screenshot,
PDF, Markdown extraction, scrape, or accessibility tree (`quickAction("accessibilityTree",
...)`)—prefer the Browser Rendering binding's `env.BROWSER.quickAction(...)`.
This returns a plain role/name/state tree with no interaction refs, so it fits
a one-shot "describe this page's structure" call rather than a click-fill-wait
loop. Starting an interactive CDP session is more appropriate for multi-step
navigation, page mutation, or debugging; use this skill's own `snapshot`
command there instead, since its accessibility tree includes stable `ref=123`
handles for follow-up `click`/`fill` commands.

## Optional MCP compatibility

If an environment already exposes Chrome DevTools MCP tools, they can still be
used. The same operating principles apply: snapshot before screenshot, reuse
tabs, set navigation timeouts, and wait for state transitions. MCP is a
compatibility path, not a requirement for this skill.

For instructions on using MCP as an alternative to the CLI, refer to this blog post: https://github.com/zeke/zeke.sikelianos.com/blob/abb5b6b1d3c1f1a9beeb76d652f8de6dcda92b05/content/browsers-in-the-cloud/index.md
