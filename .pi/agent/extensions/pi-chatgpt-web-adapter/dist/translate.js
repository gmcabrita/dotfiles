import { randomUUID } from "node:crypto";
import { DEFAULT_EFFORT, WEB_MODEL_ID } from "./constants.js";
function flattenContent(content) {
    if (content == null)
        return "";
    if (typeof content === "string")
        return content;
    if (Array.isArray(content)) {
        return content
            .map((c) => {
            if (typeof c === "string")
                return c;
            return c.text ?? c.content ?? "";
        })
            .join("");
    }
    return String(content);
}
function effortFromRequest(body) {
    const r = body?.reasoning?.effort ?? body?.reasoning_effort ?? body?.thinking_effort;
    if (r === "high" || r === "extended" || r === "max")
        return "extended";
    return DEFAULT_EFFORT;
}
export function parseOpenAIRequest(body) {
    const model = typeof body?.model === "string" && body.model ? body.model : WEB_MODEL_ID;
    const effort = effortFromRequest(body);
    const stream = body?.stream === true;
    // Responses API: `input` may be a string or an array of typed items.
    if (body && "input" in body && !("messages" in body)) {
        const systemParts = [];
        if (typeof body.instructions === "string")
            systemParts.push(body.instructions);
        let prompt = "";
        const transcript = [];
        if (typeof body.input === "string") {
            prompt = body.input;
        }
        else if (Array.isArray(body.input)) {
            const items = body.input;
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const role = item?.role ?? "user";
                const text = flattenContent(item?.content);
                if (role === "system" || role === "developer")
                    systemParts.push(text);
                else if (i === items.length - 1 && role === "user")
                    prompt = text;
                else
                    transcript.push(`${role}: ${text}`);
            }
        }
        const system = [...systemParts, transcript.length ? "Conversation so far:\n" + transcript.join("\n") : ""]
            .filter(Boolean)
            .join("\n\n");
        return { model, effort, system: system || undefined, prompt, stream, format: "responses" };
    }
    // Chat Completions API: `messages` array.
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const systemParts = [];
    const transcript = [];
    let prompt = "";
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const role = m?.role ?? "user";
        const text = flattenContent(m?.content);
        if (role === "system" || role === "developer")
            systemParts.push(text);
        else if (i === messages.length - 1 && role === "user")
            prompt = text;
        else
            transcript.push(`${role}: ${text}`);
    }
    if (!prompt && messages.length) {
        // last message wasn't a user message; use it as prompt anyway
        prompt = flattenContent(messages[messages.length - 1]?.content);
    }
    const system = [...systemParts, transcript.length ? "Conversation so far:\n" + transcript.join("\n") : ""]
        .filter(Boolean)
        .join("\n\n");
    return { model, effort, system: system || undefined, prompt, stream, format: "chat" };
}
// --- Output formatting ------------------------------------------------------
export function chatCompletionFull(model, text, reasoning) {
    const id = `chatcmpl-${randomUUID()}`;
    return {
        id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: text,
                    ...(reasoning ? { reasoning_content: reasoning } : {}),
                },
                finish_reason: "stop",
            },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
}
export function chatCompletionChunk(id, model, delta, finish = false) {
    const obj = {
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                delta: finish ? {} : delta,
                finish_reason: finish ? "stop" : null,
            },
        ],
    };
    return `data: ${JSON.stringify(obj)}\n\n`;
}
export function responsesFull(model, text, reasoning) {
    const id = `resp_${randomUUID()}`;
    const output = [];
    if (reasoning) {
        output.push({
            id: `rs_${randomUUID()}`,
            type: "reasoning",
            summary: [{ type: "summary_text", text: reasoning }],
        });
    }
    output.push({
        id: `msg_${randomUUID()}`,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
    });
    return {
        id,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "completed",
        model,
        output,
        output_text: text,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };
}
/** Minimal Responses streaming events for output_text deltas. */
export function responsesTextDeltaEvent(itemId, delta) {
    const obj = {
        type: "response.output_text.delta",
        item_id: itemId,
        output_index: 0,
        content_index: 0,
        delta,
    };
    return `event: response.output_text.delta\ndata: ${JSON.stringify(obj)}\n\n`;
}
export function responsesCompletedEvent(model, text, reasoning) {
    const obj = { type: "response.completed", response: responsesFull(model, text, reasoning) };
    return `event: response.completed\ndata: ${JSON.stringify(obj)}\n\n`;
}
//# sourceMappingURL=translate.js.map