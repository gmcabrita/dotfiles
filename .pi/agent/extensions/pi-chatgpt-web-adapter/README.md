# @minzicat/pi-chatgpt-web-adapter

Use ChatGPT web's **`gpt-5-5-pro`** (and `gpt-5-5-thinking`, `gpt-5-5`) inside
[Pi](https://github.com/earendil-works/pi) as first-class, switchable models —
riding your own ChatGPT Plus/Pro subscription.

`gpt-5-5-pro` is not exposed by the OpenAI Responses API or the Codex CLI at
plan pricing. The only way to drive it from your subscription is the
`chatgpt.com` web app. This adapter does that through a managed browser, then
re-exposes it as a local OpenAI-compatible endpoint that Pi consumes like any
other provider.

> **Personal-use tool.** It automates *your own* ChatGPT account on *your own*
> machine. Single-account, single-machine. See [docs/TOS-NOTES.md](docs/TOS-NOTES.md).

## How it works

```
Pi session  ──/models chatgpt-web/gpt-5-5-pro──▶  pi openai-completions streamer
                                                       │  http://127.0.0.1:1456/v1
                                                       ▼
                                        pi-chatgpt-web daemon (this package)
                                          ├─ managed Chromium (login + sentinel)
                                          ├─ chatgpt.com/backend-api/f/conversation
                                          └─ OpenAI ⇄ web-protocol translation
```

- **Auth** is a real browser login (Google / Microsoft / email — your choice).
  No HAR import, no pasted tokens. The JWT auto-refreshes from the long-lived
  session cookie.
- **Sentinel/Turnstile** tokens are minted by the live page, so the adapter
  survives ChatGPT frontend rotations far better than pure-HTTP reimplementations.
- **Pro turns** stream on a separate channel; the adapter polls the conversation
  to completion so you always get the full answer.

## Install

Requires Node ≥ 20.12 and a Chromium-family browser (Chrome / Chromium / Brave / Edge).

```bash
npm install -g @minzicat/pi-chatgpt-web-adapter
```

## Quick start

```bash
# 1. Log in (opens a browser window once)
pi-chatgpt-web auth login

# 2. Verify
pi-chatgpt-web doctor

# 3. In any Pi session
/models chatgpt-web/gpt-5-5-pro
```

When installed as a Pi package, the extension registers the `chatgpt-web`
provider automatically and starts the daemon on demand — no manual `serve`
needed.

## CLI

| Command | Purpose |
|---|---|
| `pi-chatgpt-web auth login` | Browser login; captures + persists the session |
| `pi-chatgpt-web auth status` | Account + token expiry |
| `pi-chatgpt-web auth refresh` | Force a token refresh |
| `pi-chatgpt-web serve [--port N]` | Run the OpenAI-compatible daemon (default 1456) |
| `pi-chatgpt-web chat "<prompt>" [--model M] [--effort standard\|extended]` | One-shot |
| `pi-chatgpt-web doctor` | Health: auth, browser, daemon |
| `pi-chatgpt-web install-agent` | Install a macOS LaunchAgent for the daemon |

## OpenAI-compatible endpoints

The daemon serves `POST /v1/chat/completions`, `POST /v1/responses`,
`GET /v1/models`, `GET /health`, `GET /doctor`. Point any OpenAI client at it:

```bash
OPENAI_BASE_URL=http://127.0.0.1:1456/v1 OPENAI_API_KEY=x \
  curl -s $OPENAI_BASE_URL/chat/completions \
  -d '{"model":"gpt-5-5-pro","messages":[{"role":"user","content":"hi"}]}'
```

## Limitations (v0.1)

- **Text only** — no tool/function calling, images, or attachments yet.
- **Stateless** — each turn replays the conversation as a fresh tree.
- **Pro latency** — Pro turns take minutes; the stream sends keep-alives.
- **Quota** — each Pro turn consumes one Pro use from your plan.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `PI_CHATGPT_WEB_PORT` | `1456` | Daemon port |
| `PI_CHATGPT_WEB_CHROME` | auto | Path to Chromium executable |
| `PI_CHATGPT_WEB_HEADFUL` | unset | Run the browser visibly (debugging) |
| `PI_CHATGPT_WEB_PROFILE_DIR` | `~/.cache/pi-chatgpt-web/profile` | Browser profile |
| `PI_CHATGPT_WEB_AUTH_FILE` | `~/.pi/agent/chatgpt-web-auth.json` | JWT hot cache (mode 600) |
| `PI_CHATGPT_WEB_LOG_LEVEL` | `info` | `debug\|info\|warn\|error` |

## Troubleshooting

- **`doctor` says not logged in** → `pi-chatgpt-web auth login`.
- **401 on chat** → session cookie expired; re-run `auth login`.
- **`no Chromium found`** → install Chrome or set `PI_CHATGPT_WEB_CHROME`.
- **Empty answers / sentinel errors after a ChatGPT update** → the frontend
  rotated; restart the daemon. If it persists, the in-page mint may need an
  update (`docs/ARCHITECTURE.md`).

## License

MIT
