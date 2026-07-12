/**
 * Reassembler for ChatGPT web's `delta_encoding: v1` SSE stream.
 *
 * The stream is a sequence of `event: delta` frames whose `data` is a
 * JSON-Patch-like op against a single virtual "message tree" document, plus
 * bare `data:` control frames (resume tokens, stream_handoff, metadata).
 *
 * This module is transport-agnostic: feed it raw SSE text chunks (from a Node
 * fetch body, an in-page fetch, or a resumed websocket framed as SSE) and it
 * emits structured events + accumulates the final assistant message.
 */
const VISIBLE_ASSISTANT_ROLES = new Set(["assistant"]);
export class DeltaReassembler {
    events;
    buffer = "";
    doc = undefined;
    conversationId;
    topicId;
    answer = "";
    reasoning = "";
    done = false;
    sawHandoff = false;
    constructor(events = {}) {
        this.events = events;
    }
    get isDone() {
        return this.done;
    }
    get handoffRequested() {
        return this.sawHandoff;
    }
    get resumeTopicId() {
        return this.topicId;
    }
    get conversation() {
        return this.conversationId;
    }
    result() {
        return { text: this.answer, reasoning: this.reasoning };
    }
    /** Feed a raw chunk of SSE text. Safe to call repeatedly with partial data. */
    push(chunk) {
        this.buffer += chunk;
        let idx;
        // SSE frames are separated by a blank line ("\n\n").
        while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
            const frame = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx + 2);
            this.handleFrame(frame);
        }
    }
    /** Flush any trailing frame not terminated by a blank line. */
    end() {
        if (this.buffer.trim().length) {
            this.handleFrame(this.buffer);
            this.buffer = "";
        }
    }
    handleFrame(frame) {
        const lines = frame.split("\n");
        let eventName;
        const dataLines = [];
        for (const line of lines) {
            if (line.startsWith(":"))
                continue; // comment / heartbeat
            if (line.startsWith("event:"))
                eventName = line.slice(6).trim();
            else if (line.startsWith("data:"))
                dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        if (dataLines.length === 0)
            return;
        const dataStr = dataLines.join("\n");
        if (dataStr === "[DONE]") {
            this.done = true;
            this.events.onControl?.({ type: "done" });
            return;
        }
        // The version banner: data: "v1"
        if (dataStr === '"v1"' || eventName === "delta_encoding")
            return;
        let payload;
        try {
            payload = JSON.parse(dataStr);
        }
        catch {
            return; // ignore unparseable frames
        }
        if (eventName === "delta") {
            this.applyDelta(payload);
            return;
        }
        // Bare data frames carry control payloads.
        this.handleControl(payload);
    }
    handleControl(payload) {
        if (payload?.conversation_id)
            this.conversationId = payload.conversation_id;
        const type = payload?.type;
        if (type === "resume_conversation_token") {
            this.events.onControl?.({
                type: "resume_conversation_token",
                token: payload.token,
                conversationId: payload.conversation_id,
                raw: payload,
            });
            return;
        }
        if (type === "stream_handoff") {
            this.sawHandoff = true;
            const sse = (payload.options || []).find((o) => o?.type === "resume_sse_endpoint");
            const ws = (payload.options || []).find((o) => o?.type === "subscribe_ws_topic");
            this.topicId = sse?.topic_id || ws?.topic_id;
            this.events.onControl?.({
                type: "stream_handoff",
                conversationId: payload.conversation_id,
                topicId: this.topicId,
                raw: payload,
            });
            return;
        }
        if (type === "title_generation") {
            this.events.onControl?.({ type: "title_generation", title: payload.title, raw: payload });
            return;
        }
        if (type === "input_message") {
            this.events.onControl?.({ type: "input_message", raw: payload });
            return;
        }
        if (typeof type === "string" && type.endsWith("metadata")) {
            this.events.onControl?.({ type: "metadata", raw: payload });
            return;
        }
        this.events.onControl?.({ type: "other", raw: payload });
    }
    applyDelta(delta) {
        const op = delta.o;
        const ptr = delta.p;
        const value = delta.v;
        if (op === undefined && (ptr === undefined || ptr === "")) {
            // Whole-document replace (new message branch). v is the full doc.
            this.doc = value;
            this.afterDocChange();
            return;
        }
        if (ptr === "" && (op === "add" || op === "replace")) {
            this.doc = value;
            this.afterDocChange();
            return;
        }
        if (op === "patch" && Array.isArray(value)) {
            for (const sub of value)
                this.applyDelta(sub);
            return;
        }
        const pointer = ptr ?? "";
        if (op === "append") {
            this.appendAtPointer(pointer, String(value ?? ""));
        }
        else {
            // add | replace | (default) → set value at pointer
            this.setAtPointer(pointer, value);
        }
        this.afterDocChange(pointer, op, value);
    }
    // --- JSON pointer helpers (RFC6901-ish, sufficient for this protocol) ---
    resolveParent(pointer) {
        if (!pointer.startsWith("/"))
            return null;
        const tokens = pointer
            .slice(1)
            .split("/")
            .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
        let node = this.doc;
        for (let i = 0; i < tokens.length - 1; i++) {
            const key = tokens[i];
            if (node == null)
                return null;
            node = Array.isArray(node) ? node[Number(key)] : node[key];
        }
        return { parent: node, key: tokens[tokens.length - 1] };
    }
    setAtPointer(pointer, value) {
        if (pointer === "") {
            this.doc = value;
            return;
        }
        const res = this.resolveParent(pointer);
        if (!res || res.parent == null)
            return;
        if (Array.isArray(res.parent))
            res.parent[Number(res.key)] = value;
        else
            res.parent[res.key] = value;
    }
    appendAtPointer(pointer, value) {
        const res = this.resolveParent(pointer);
        if (!res || res.parent == null)
            return;
        const key = Array.isArray(res.parent) ? Number(res.key) : res.key;
        const current = res.parent[key];
        res.parent[key] = (typeof current === "string" ? current : "") + value;
    }
    // --- after each mutation, recompute visible answer / reasoning ---
    afterDocChange(_pointer, _op, _value) {
        const msg = this.doc?.message;
        if (!msg)
            return;
        if (this.doc?.conversation_id)
            this.conversationId = this.doc.conversation_id;
        const tracked = classify(msg);
        if (tracked.hidden)
            return;
        const joined = tracked.parts.join("");
        if (tracked.reasoning) {
            if (joined.length >= this.reasoning.length) {
                const chunk = joined.slice(this.reasoning.length);
                this.reasoning = joined;
                if (chunk)
                    this.events.onReasoningDelta?.(chunk, this.reasoning);
            }
            return;
        }
        if (tracked.role && VISIBLE_ASSISTANT_ROLES.has(tracked.role)) {
            if (joined.length >= this.answer.length) {
                const chunk = joined.slice(this.answer.length);
                this.answer = joined;
                if (chunk)
                    this.events.onTextDelta?.(chunk, this.answer);
            }
            else {
                // Branch switched (e.g. resume replaced doc); take the longer.
                this.answer = joined.length > this.answer.length ? joined : this.answer;
            }
        }
    }
}
function classify(msg) {
    const role = msg?.author?.role;
    const contentType = msg?.content?.content_type;
    const meta = msg?.metadata ?? {};
    const hidden = !!meta.is_visually_hidden_from_conversation;
    // The "tool" author with initial_text "Reasoning" is the CoT summary stream.
    const reasoning = role === "tool" ||
        contentType === "thoughts" ||
        contentType === "reasoning_recap" ||
        meta.initial_text === "Reasoning";
    const parts = extractParts(msg?.content);
    return {
        id: msg?.id,
        role,
        contentType,
        parts,
        hidden: hidden && !reasoning ? true : reasoning ? false : hidden,
        reasoning,
        status: msg?.status,
    };
}
function extractParts(content) {
    if (!content)
        return [];
    const parts = content.parts;
    if (Array.isArray(parts)) {
        return parts.map((p) => {
            if (typeof p === "string")
                return p;
            if (p && typeof p === "object")
                return p.text ?? p.content ?? p.summary ?? "";
            return "";
        });
    }
    if (typeof content.text === "string")
        return [content.text];
    return [];
}
/** Convenience: reassemble a complete SSE string in one shot. */
export function reassembleAll(sse, events) {
    const r = new DeltaReassembler(events);
    r.push(sse);
    r.end();
    const { text, reasoning } = r.result();
    return {
        text,
        reasoning,
        conversationId: r.conversation,
        handoff: r.handoffRequested,
        topicId: r.resumeTopicId,
    };
}
//# sourceMappingURL=sse-reassembler.js.map