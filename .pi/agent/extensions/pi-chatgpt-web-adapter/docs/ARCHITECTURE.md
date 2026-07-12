# Architecture

Full protocol dossier and design rationale live in the research repo:
`~/Developer/local-research/chatgpt-web-gpt5-pro/` (`00-RECON.md`,
`01-HANDOFF.md`, `02-STREAM-HANDOFF.md`). This file is the in-repo summary.

## Layers (bottom-up)

1. **Browser bridge** (`src/browser/`)
   - `chrome-path.ts` finds a Chromium-family executable (no bundled browser).
   - `supervisor.ts` (`ManagedChrome`) owns a persistent-profile Chromium via
     `puppeteer-core`, navigates to `chatgpt.com`, and exposes `fetchSession`,
     `mintSentinelHeaders`, `ping`, `pageContext`.
   - **Sentinel token-oracle** (`mintSentinelHeaders`): a CDP `Fetch` session
     intercepts `POST /backend-api/f/conversation` at the Request stage. To mint,
     we type into the real composer + press Enter; when the SPA's own request is
     paused we snapshot its fully-minted headers (the `OpenAI-Sentinel-*` triple
     plus `OAI-*` identity + `X-OpenAI-Target-*` routing headers) and immediately
     `Fetch.failRequest{Aborted}` — so nothing reaches the server (no turn
     consumed, no history). The daemon then reuses those headers for its own real
     `/f/conversation` call. The proof-of-work / turnstile is computed by
     OpenAI's own versioned, iframe-sandboxed SDK, so we never port the algorithm.
   - `hooks.ts` is injected with `evaluateOnNewDocument` *before* the React app
     boots; it wraps `window.fetch` to passively capture the bearer JWT and the
     `OpenAI-Sentinel-*` tokens as a fallback/telemetry layer.

2. **Auth** (`src/auth/`)
   - `login.ts` — visible browser login; polls `/api/auth/session` for the JWT.
   - `refresh.ts` — re-mints the JWT from the long-lived session cookie when
     within 300s of expiry; throws `SessionExpiredError` when re-login is needed.
   - `store.ts` — atomic mode-600 read/write of `~/.pi/agent/chatgpt-web-auth.json`.
   - `jwt.ts` — dependency-free JWT *decode* (never verify) for claims/expiry.

3. **Chat** (`src/chat/`)
   - `sse-reassembler.ts` — `delta_encoding v1` reassembler. JSON-pointer ops
     (`add`/`replace`/`append`/`patch`), separates hidden system messages,
     reasoning (`author.role:"tool"` / `thoughts`), and the visible answer.
     Fully unit-tested.
   - `conversation.ts` (`ChatClient`) — mints a fresh sentinel header set per
     turn (single-use requirements tokens), retries once on a 403/401, POSTs
     `/f/conversation` **inside the page** (so cookies/cf_clearance are real), reassembles
     inline deltas, and on a Pro `stream_handoff` polls the conversation detail
     to completion (the guaranteed-correct floor).

4. **Translation** (`src/translate.ts`)
   - OpenAI Chat Completions + Responses requests → internal `ChatTurn`
     (system/transcript flattening), and results → OpenAI streaming/non-streaming
     payloads. Unit-tested both directions.

5. **HTTP surface** (`src/server/`)
   - `http.ts` (`AdapterServer`) — `node:http` daemon on `127.0.0.1`. Routes:
     `/v1/chat/completions`, `/v1/responses`, `/v1/models`, `/health`, `/doctor`.
     Streaming sends `: ping` keep-alives during long Pro thinks.
   - `runtime.ts` — daemon registry (`~/.cache/pi-chatgpt-web/daemon.json`) +
     liveness probe.

6. **Pi extension** (`extensions/index.ts`)
   - Registers the `chatgpt-web` provider with three models pointed at the local
     daemon via the built-in `openai-completions` API, and spawns the daemon on
     demand. Runtime uses only Node builtins (the one pi import is a type).

## Key protocol fact

`gpt-5-5-pro` does not return its answer inline on `/f/conversation`. It emits a
`stream_handoff` and the answer streams on a websocket / resume-SSE topic. v0
handles this by polling `GET /backend-api/conversation/<id>` to completion. Token
streaming over the resume channel is a v0.2 enhancement that does not change the
public surface. See `02-STREAM-HANDOFF.md`.

## Durability

- **Sentinel = token-oracle, not a reimplementation.** ChatGPT's anti-bot is a
  dated, iframe-sandboxed SDK (`/sentinel/sdk.js`, `frame.html?sv=<date>`,
  `/sentinel/req`) that rotates on OpenAI's schedule. We never hand-port the PoW;
  the real logged-in page runs OpenAI's *current* sentinel code and we harvest the
  tokens via the CDP `Fetch` oracle. When they rotate the algorithm, their JS
  rotates with it and we follow for free. Full rationale + the exact captured
  header set: `~/Developer/local-research/chatgpt-web-gpt5-pro/03-SENTINEL-ORACLE.md`.
- **Headful by default.** The sentinel SDK + composer do not render reliably in
  (new) headless Chrome, which breaks minting; the daemon runs one persistent
  headful Chrome for its lifetime (co-resident sentinel co-processor, not a
  renderer). `PI_CHATGPT_WEB_HEADLESS=1` opts into headless for experimentation.
- `WEB_MODEL_ID` is a single constant; a model rename is a one-line fix.
