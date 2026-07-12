import { randomUUID } from "node:crypto";
import { CHATGPT_ORIGIN, ROUTES, WEB_MODEL_ID } from "../constants.js";
import { createLogger } from "../log.js";
import { reassembleAll } from "./sse-reassembler.js";
const log = createLogger("chat");
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 20 * 60_000; // Pro turns can run many minutes.
export class ChatClient {
    chrome;
    constructor(chrome) {
        this.chrome = chrome;
    }
    async run(turn, bearer) {
        throwIfAborted(turn.signal);
        const model = turn.model || WEB_MODEL_ID;
        const effort = turn.effort || "standard";
        const page = await this.chrome.pageContext();
        throwIfAborted(turn.signal);
        const userMessageId = randomUUID();
        const promptText = turn.system ? `${turn.system}\n\n${turn.prompt}` : turn.prompt;
        // Best-effort prepare (warms the route; we ignore its result).
        await this.prepare(page, model, effort, promptText, bearer).catch(() => { });
        const body = {
            action: "next",
            messages: [
                {
                    id: userMessageId,
                    author: { role: "user" },
                    create_time: Date.now() / 1000,
                    content: { content_type: "text", parts: [promptText] },
                    metadata: {
                        selected_sources: [],
                        selected_github_repos: [],
                        selected_all_github_repos: false,
                        serialization_metadata: { custom_symbol_offsets: [] },
                    },
                },
            ],
            parent_message_id: "client-created-root",
            model,
            timezone_offset_min: new Date().getTimezoneOffset(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            conversation_mode: { kind: "primary_assistant" },
            enable_message_followups: true,
            system_hints: [],
            supports_buffering: true,
            supported_encodings: ["v1"],
            client_contextual_info: { is_dark_mode: true, app_name: "chatgpt.com" },
            paragen_cot_summary_display_override: "allow",
            force_parallel_switch: "auto",
            thinking_effort: effort,
        };
        throwIfAborted(turn.signal);
        const sse = await this.sendWithSentinel(page, body, bearer, turn.signal);
        const controls = [];
        const reassembled = reassembleAll(sse, {
            onTextDelta: turn.onTextDelta,
            onReasoningDelta: turn.onReasoningDelta,
            onControl: (f) => controls.push(f),
        });
        let { text, reasoning } = reassembled;
        const conversationId = reassembled.conversationId;
        let viaPoll = false;
        if (reassembled.handoff || (!text && conversationId)) {
            // Pro path: answer streams on a separate topic. Poll the conversation to
            // completion and read the final assistant message.
            viaPoll = true;
            const polled = await this.pollToCompletion(page, conversationId, bearer, turn);
            if (polled.text)
                text = polled.text;
            if (polled.reasoning && !reasoning)
                reasoning = polled.reasoning;
            if (text)
                turn.onTextDelta?.(text, text);
        }
        return { text, reasoning, conversationId, model, viaPoll };
    }
    /**
     * Mint a fresh sentinel header set (via the page's own SDK), attach our
     * per-request headers, and POST /f/conversation. On a 403/401 (stale or
     * anti-bot-rejected sentinel) re-mint once and retry.
     */
    async sendWithSentinel(page, body, bearer, signal) {
        let attempt = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            throwIfAborted(signal);
            const sentinel = await this.chrome.mintSentinelHeaders();
            const headers = {
                ...sentinel.headers,
                "content-type": "application/json",
                accept: "text/event-stream",
                authorization: `Bearer ${bearer}`,
                "x-oai-turn-trace-id": randomUUID(),
            };
            try {
                return await this.postConversationInPage(page, body, headers);
            }
            catch (e) {
                if (e instanceof ChatError && (e.status === 403 || e.status === 401) && attempt === 0) {
                    attempt += 1;
                    log.warn("conversation rejected; re-minting sentinel and retrying", { status: e.status });
                    continue;
                }
                throw e;
            }
        }
    }
    async prepare(page, model, effort, firstChar, bearer) {
        const body = {
            action: "next",
            parent_message_id: "client-created-root",
            model,
            client_prepare_state: "none",
            timezone_offset_min: new Date().getTimezoneOffset(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            conversation_mode: { kind: "primary_assistant" },
            system_hints: [],
            partial_query: {
                id: randomUUID(),
                author: { role: "user" },
                content: { content_type: "text", parts: [firstChar.slice(0, 1)] },
            },
            supports_buffering: true,
            supported_encodings: ["v1"],
            client_contextual_info: { app_name: "chatgpt.com" },
            thinking_effort: effort,
        };
        await page.evaluate(async (route, b, token) => {
            await fetch(route, {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
                body: JSON.stringify(b),
            }).catch(() => { });
        }, ROUTES.conversationPrepare, body, bearer);
    }
    /** POST /f/conversation inside the page; buffer the full SSE body. */
    async postConversationInPage(page, body, headers) {
        const res = (await page.evaluate(async (route, b, h) => {
            try {
                const resp = await fetch(route, {
                    method: "POST",
                    credentials: "include",
                    headers: h,
                    body: JSON.stringify(b),
                });
                if (!resp.ok) {
                    const errText = await resp.text().catch(() => "");
                    return { ok: false, status: resp.status, text: errText };
                }
                const text = await resp.text();
                return { ok: true, status: resp.status, text };
            }
            catch (e) {
                return { ok: false, status: 0, text: String(e) };
            }
        }, ROUTES.conversation, body, headers));
        if (!res.ok) {
            throw new ChatError(res.status, res.text);
        }
        return res.text;
    }
    /**
     * Poll stream_status until the turn finishes, then fetch the conversation
     * detail and extract the final assistant message + reasoning. Guaranteed-
     * correct floor for Pro turns regardless of streaming transport.
     */
    async pollToCompletion(page, conversationId, bearer, turn) {
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        let lastText = "";
        let lastReasoning = "";
        while (Date.now() < deadline) {
            throwIfAborted(turn.signal);
            const detail = await this.fetchConversationDetail(page, conversationId, bearer);
            if (detail) {
                const extracted = extractFinal(detail);
                if (extracted.text)
                    lastText = extracted.text;
                if (extracted.reasoning)
                    lastReasoning = extracted.reasoning;
                if (extracted.finished && lastText) {
                    return { text: lastText, reasoning: lastReasoning };
                }
            }
            turn.onHeartbeat?.();
            await delay(POLL_INTERVAL_MS, turn.signal);
        }
        log.warn("poll timed out", { conversationId });
        return { text: lastText, reasoning: lastReasoning };
    }
    async fetchConversationDetail(page, conversationId, bearer) {
        return page.evaluate(async (origin, convId, token) => {
            try {
                const resp = await fetch(`${origin}/backend-api/conversation/${convId}`, {
                    credentials: "include",
                    headers: { accept: "application/json", authorization: `Bearer ${token}` },
                });
                if (!resp.ok)
                    return null;
                return await resp.json();
            }
            catch {
                return null;
            }
        }, CHATGPT_ORIGIN, conversationId, bearer);
    }
}
export class ChatError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`chat request failed (HTTP ${status}): ${body.slice(0, 300)}`);
        this.status = status;
        this.body = body;
        this.name = "ChatError";
    }
}
/**
 * Extract the final assistant answer + reasoning from a /conversation detail
 * mapping. Picks the most recent finished assistant message and the most recent
 * reasoning (tool) message.
 */
function extractFinal(detail) {
    const mapping = detail?.mapping;
    if (!mapping || typeof mapping !== "object") {
        return { text: "", reasoning: "", finished: false };
    }
    let bestAnswer = "";
    let bestAnswerTime = -1;
    let bestAnswerFinished = false;
    let bestReasoning = "";
    let bestReasoningTime = -1;
    for (const key of Object.keys(mapping)) {
        const msg = mapping[key]?.message;
        if (!msg)
            continue;
        const role = msg.author?.role;
        const meta = msg.metadata ?? {};
        const time = msg.create_time ?? msg.update_time ?? 0;
        const isReasoning = role === "tool" || msg.content?.content_type === "thoughts" || meta.initial_text === "Reasoning";
        const parts = joinParts(msg.content);
        if (isReasoning) {
            if (time >= bestReasoningTime && parts) {
                bestReasoning = parts;
                bestReasoningTime = time;
            }
            continue;
        }
        if (role === "assistant" && !meta.is_visually_hidden_from_conversation) {
            if (time >= bestAnswerTime) {
                bestAnswer = parts;
                bestAnswerTime = time;
                bestAnswerFinished = msg.status === "finished_successfully" && msg.end_turn !== false;
            }
        }
    }
    return { text: bestAnswer, reasoning: bestReasoning, finished: bestAnswerFinished };
}
function joinParts(content) {
    if (!content)
        return "";
    const parts = content.parts;
    if (Array.isArray(parts)) {
        return parts
            .map((p) => (typeof p === "string" ? p : p?.text ?? p?.content ?? p?.summary ?? ""))
            .join("");
    }
    if (typeof content.text === "string")
        return content.text;
    return "";
}
function throwIfAborted(signal) {
    if (signal?.aborted)
        throw new Error("aborted");
}
function delay(ms, signal) {
    if (!signal)
        return new Promise((resolve) => setTimeout(resolve, ms));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
    });
}
//# sourceMappingURL=conversation.js.map