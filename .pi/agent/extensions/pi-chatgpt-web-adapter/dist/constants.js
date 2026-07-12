import { homedir } from "node:os";
import { join } from "node:path";
/**
 * Central, single-source-of-truth constants for the adapter.
 *
 * The web model identifier is the one thing most likely to rotate on OpenAI's
 * side. Keep it here so a single edit (plus a CI smoke run) recovers from a
 * rename.
 */
export const WEB_MODEL_ID = "gpt-5-6-pro";
/** Model ids the adapter advertises through /v1/models. */
export const ADVERTISED_MODELS = ["gpt-5-6-pro"];
export const DEFAULT_EFFORT = "standard";
/** Default loopback port for the local OpenAI-compatible daemon. */
export const DEFAULT_PORT = 1456;
export const DEFAULT_HOST = "127.0.0.1";
export const CHATGPT_ORIGIN = "https://chatgpt.com";
// chatgpt.com backend-api routes we touch.
export const ROUTES = {
    authSession: "/api/auth/session",
    sentinelPrepare: "/backend-api/sentinel/chat-requirements/prepare",
    sentinelFinalize: "/backend-api/sentinel/chat-requirements/finalize",
    sentinelPing: "/backend-api/sentinel/ping",
    conversationPrepare: "/backend-api/f/conversation/prepare",
    conversation: "/backend-api/f/conversation",
};
function piAgentDir() {
    // Honour PI_AGENT_DIR if set, else default to ~/.pi/agent.
    const override = process.env.PI_CHATGPT_WEB_AGENT_DIR || process.env.PI_AGENT_DIR;
    if (override)
        return override;
    return join(homedir(), ".pi", "agent");
}
function cacheDir() {
    const override = process.env.PI_CHATGPT_WEB_CACHE_DIR;
    if (override)
        return override;
    return join(homedir(), ".cache", "pi-chatgpt-web");
}
export const PATHS = {
    /** mode-600 hot cache of the JWT + account metadata. */
    authFile: () => process.env.PI_CHATGPT_WEB_AUTH_FILE ||
        join(piAgentDir(), "chatgpt-web-auth.json"),
    /** Persistent Chromium profile (cookies, NextAuth session token live here). */
    profileDir: () => process.env.PI_CHATGPT_WEB_PROFILE_DIR || join(cacheDir(), "profile"),
    /** Runtime file describing the live daemon (port, pid). */
    runtimeFile: () => join(cacheDir(), "daemon.json"),
    logDir: () => join(cacheDir(), "log"),
    cacheDir,
};
/** Refresh the JWT when fewer than this many seconds remain before expiry. */
export const REFRESH_SKEW_SECONDS = 300;
/** Conservative client-side throttle target; TODO(v0.2): enforce before each ChatClient.run call. */
export const MAX_TURNS_PER_HOUR = 60;
export const USER_AGENT_HINT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
//# sourceMappingURL=constants.js.map