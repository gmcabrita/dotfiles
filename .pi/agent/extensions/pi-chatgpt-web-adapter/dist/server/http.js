import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { ADVERTISED_MODELS, DEFAULT_HOST, DEFAULT_PORT } from "../constants.js";
import { createLogger } from "../log.js";
import { ManagedChrome } from "../browser/supervisor.js";
import { ChatClient, ChatError } from "../chat/conversation.js";
import { ensureFreshToken, SessionExpiredError } from "../auth/refresh.js";
import { authHealth } from "../auth/store.js";
import { parseOpenAIRequest, chatCompletionChunk, chatCompletionFull, responsesFull, responsesTextDeltaEvent, responsesCompletedEvent, } from "../translate.js";
const log = createLogger("server");
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const HEARTBEAT_MS = 10_000;
export class AdapterServer {
    opts;
    chrome;
    chat;
    server = createServer((req, res) => this.handle(req, res));
    warmTimer = null;
    constructor(opts = {}) {
        this.opts = opts;
        this.chrome = new ManagedChrome({ headless: opts.headless ?? false });
        this.chat = new ChatClient(this.chrome);
    }
    async listen() {
        const host = this.opts.host ?? DEFAULT_HOST;
        const port = this.opts.port ?? DEFAULT_PORT;
        await new Promise((resolve, reject) => {
            this.server.once("error", reject);
            this.server.listen(port, host, () => {
                this.server.off("error", reject);
                resolve();
            });
        });
        log.info("listening", { host, port });
        this.startKeepWarm();
        return { host, port };
    }
    async close() {
        if (this.warmTimer)
            clearInterval(this.warmTimer);
        await new Promise((resolve) => this.server.close(() => resolve()));
        await this.chrome.close();
    }
    startKeepWarm() {
        // Ping every 30s to keep the anti-bot score warm; best-effort.
        this.warmTimer = setInterval(() => {
            this.chrome.ping().catch(() => { });
        }, 30_000);
        this.warmTimer.unref?.();
    }
    async handle(req, res) {
        const url = new URL(req.url || "/", "http://localhost");
        const path = url.pathname.replace(/\/+$/, "") || "/";
        try {
            if (req.method === "GET" && (path === "/health" || path === "/")) {
                return this.json(res, 200, { status: "ok", service: "pi-chatgpt-web-adapter" });
            }
            if (req.method === "GET" && path === "/doctor") {
                return this.json(res, 200, await this.doctorReport());
            }
            if (req.method === "GET" && (path === "/v1/models" || path === "/models")) {
                return this.json(res, 200, {
                    object: "list",
                    data: ADVERTISED_MODELS.map((id) => ({ id, object: "model", owned_by: "openai-chatgpt-web" })),
                });
            }
            if (req.method === "POST" && (path === "/v1/chat/completions" || path === "/chat/completions")) {
                return await this.handleChat(req, res, "chat");
            }
            if (req.method === "POST" && (path === "/v1/responses" || path === "/responses")) {
                return await this.handleChat(req, res, "responses");
            }
            this.json(res, 404, { error: { message: `no route for ${req.method} ${path}` } });
        }
        catch (err) {
            log.error("unhandled", { err: String(err) });
            const status = statusCode(err) ?? 500;
            const message = err instanceof Error ? err.message : String(err);
            if (!res.headersSent)
                this.json(res, status, { error: { message } });
            else
                res.end();
        }
    }
    async handleChat(req, res, surface) {
        const body = await readJson(req);
        const parsed = parseOpenAIRequest(body);
        if (!parsed.prompt) {
            return this.json(res, 400, { error: { message: "no prompt content in request" } });
        }
        let bearer;
        try {
            bearer = await ensureFreshToken(this.chrome);
        }
        catch (err) {
            const status = err instanceof SessionExpiredError ? 401 : 500;
            return this.json(res, status, { error: { message: err.message } });
        }
        if (!parsed.stream) {
            try {
                const signal = disconnectSignal(res);
                const result = await this.chat.run({ prompt: parsed.prompt, system: parsed.system, model: parsed.model, effort: parsed.effort, signal }, bearer);
                const payload = surface === "responses"
                    ? responsesFull(result.model, result.text, result.reasoning || undefined)
                    : chatCompletionFull(result.model, result.text, result.reasoning || undefined);
                return this.json(res, 200, payload);
            }
            catch (err) {
                return this.chatError(res, err);
            }
        }
        // Streaming response.
        res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
        });
        const itemId = `msg_${randomUUID()}`;
        const streamId = `chatcmpl-${randomUUID()}`;
        const signal = disconnectSignal(res);
        const heartbeat = setInterval(() => {
            if (!signal.aborted)
                res.write(": ping\n\n");
        }, HEARTBEAT_MS);
        heartbeat.unref?.();
        if (surface === "chat")
            res.write(chatCompletionChunk(streamId, parsed.model, { role: "assistant" }));
        try {
            const result = await this.chat.run({
                prompt: parsed.prompt,
                system: parsed.system,
                model: parsed.model,
                effort: parsed.effort,
                signal,
                onTextDelta: (chunk) => {
                    if (signal.aborted)
                        return;
                    if (surface === "chat")
                        res.write(chatCompletionChunk(streamId, parsed.model, { content: chunk }));
                    else
                        res.write(responsesTextDeltaEvent(itemId, chunk));
                },
                onHeartbeat: () => {
                    if (!signal.aborted)
                        res.write(": working\n\n");
                },
            }, bearer);
            clearInterval(heartbeat);
            if (surface === "chat") {
                res.write(chatCompletionChunk(streamId, parsed.model, {}, true));
                res.write("data: [DONE]\n\n");
            }
            else {
                res.write(responsesCompletedEvent(result.model, result.text, result.reasoning || undefined));
                res.write("data: [DONE]\n\n");
            }
            res.end();
        }
        catch (err) {
            clearInterval(heartbeat);
            const message = err instanceof Error ? err.message : String(err);
            log.error("stream failed", { message });
            res.write(`event: error\ndata: ${JSON.stringify({ error: { message } })}\n\n`);
            res.end();
        }
    }
    chatError(res, err) {
        if (err instanceof ChatError) {
            return this.json(res, err.status || 502, { error: { message: err.message } });
        }
        if (err instanceof SessionExpiredError) {
            return this.json(res, 401, { error: { message: err.message } });
        }
        return this.json(res, 502, { error: { message: String(err) } });
    }
    async doctorReport() {
        const auth = authHealth(300);
        let browser = "unknown";
        let sentinel = "unknown";
        try {
            await this.chrome.pageContext();
            browser = "ok";
            const set = await this.chrome.mintSentinelHeaders();
            sentinel = set.headers["openai-sentinel-chat-requirements-token"] ? "ok" : "no-token";
        }
        catch (err) {
            browser = `error: ${err.message}`;
        }
        return { auth, browser, sentinel };
    }
    json(res, status, payload) {
        const data = JSON.stringify(payload);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(data);
    }
}
function disconnectSignal(res) {
    const ac = new AbortController();
    res.once("close", () => {
        if (!res.writableEnded)
            ac.abort();
    });
    return ac.signal;
}
function withStatus(err, status) {
    return Object.assign(err, { statusCode: status });
}
function statusCode(err) {
    if (typeof err === "object" && err && "statusCode" in err) {
        const code = Number(err.statusCode);
        if (Number.isInteger(code) && code >= 400 && code <= 599)
            return code;
    }
    return undefined;
}
function readJson(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (c) => {
            size += c.length;
            if (size > MAX_BODY_BYTES) {
                reject(withStatus(new Error("request body too large"), 413));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => {
            if (!chunks.length)
                return resolve({});
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            }
            catch {
                reject(withStatus(new Error("invalid JSON body"), 400));
            }
        });
        req.on("error", reject);
    });
}
//# sourceMappingURL=http.js.map