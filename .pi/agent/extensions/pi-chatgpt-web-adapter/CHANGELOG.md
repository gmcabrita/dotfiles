# Changelog

## Unreleased

- Updated the ChatGPT web model to `gpt-5-6-pro`.
- Removed the non-Pro models from the advertised model list and Pi provider.

## 0.1.1 (2026-06-18)

Initial npm release. Same adapter as the GitHub `v0.1.0` release, with package metadata normalized for npm.

- Managed-browser auth: `auth login` captures a ChatGPT session JWT via a real
  browser login (no HAR import / no pasted tokens), persisted mode-600 at
  `~/.pi/agent/chatgpt-web-auth.json`, auto-refreshed from the long-lived
  NextAuth session cookie.
- Sentinel token-oracle: a CDP `Fetch` session intercepts the SPA's own
  `POST /f/conversation`, snapshots the fully-minted header set
  (`OpenAI-Sentinel-*` triple + `OAI-*` identity + `X-OpenAI-Target-*` routing),
  and aborts it before it reaches the server (no turn consumed) — then the daemon
  reuses those headers for its real call. The proof-of-work/turnstile is computed
  by OpenAI's own versioned SDK, so no algorithm is ported and frontend rotations
  are absorbed automatically. Runs headful by default (the SDK + composer don't
  render reliably headless); `PI_CHATGPT_WEB_HEADLESS=1` opts in. Validated live
  against `gpt-5-5-pro` (200 + correct answers, end-to-end via the daemon).
  `doctor --probe` mints once and asserts the full triple.
- Chat client: in-page `f/conversation` transport with `delta_encoding v1`
  reassembly; Pro-turn poll-to-completion fallback for the websocket/resume-SSE
  handoff.
- OpenAI-compatible daemon: `POST /v1/chat/completions`, `POST /v1/responses`
  (streaming + non-streaming), `GET /v1/models`, `/health`, `/doctor`.
- Pi extension: registers the `chatgpt-web` provider (`gpt-5-5-pro`,
  `gpt-5-5-thinking`, `gpt-5-5`) and starts the daemon on demand.
- CLI: `auth login|status|refresh`, `serve`, `chat`, `doctor`, `install-agent`.
- Tests: delta_encoding v1 reassembler (7) + OpenAI translation (8).

Known limitations: text-only (no tools/images), stateless turns.
