import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "./constants.js";
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
function envLevel() {
    const raw = (process.env.PI_CHATGPT_WEB_LOG_LEVEL || "info").toLowerCase();
    return LEVELS[raw] ?? LEVELS.info;
}
function ts() {
    return new Date().toISOString();
}
function writeFileLine(name, line) {
    try {
        const dir = PATHS.logDir();
        mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, name), line + "\n");
    }
    catch {
        // best-effort; never throw from the logger
    }
}
function emit(level, scope, msg, extra) {
    if (LEVELS[level] < envLevel())
        return;
    const detail = extra === undefined ? "" : " " + safeJson(extra);
    const line = `${ts()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${detail}`;
    const stream = level === "error" || level === "warn" ? process.stderr : process.stderr;
    // CLI human output goes through console.log elsewhere; logs go to stderr +
    // file so they never corrupt SSE/stdout payloads.
    stream.write(line + "\n");
    writeFileLine("adapter.log", line);
}
function safeJson(value) {
    try {
        return typeof value === "string" ? value : JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
export function createLogger(scope) {
    return {
        debug: (msg, extra) => emit("debug", scope, msg, extra),
        info: (msg, extra) => emit("info", scope, msg, extra),
        warn: (msg, extra) => emit("warn", scope, msg, extra),
        error: (msg, extra) => emit("error", scope, msg, extra),
    };
}
//# sourceMappingURL=log.js.map