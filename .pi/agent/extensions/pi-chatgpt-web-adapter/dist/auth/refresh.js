import { REFRESH_SKEW_SECONDS } from "../constants.js";
import { createLogger } from "../log.js";
import { secondsUntilExpiry } from "./jwt.js";
import { authStateFromToken, readAuthState, writeAuthState, } from "./store.js";
const log = createLogger("refresh");
export class SessionExpiredError extends Error {
    constructor(message) {
        super(message);
        this.name = "SessionExpiredError";
    }
}
/**
 * Re-mint the JWT from the long-lived NextAuth session cookie by hitting
 * /api/auth/session inside the warm tab. Persists and returns the new state.
 *
 * Throws SessionExpiredError when the underlying session cookie itself has
 * expired (the user must `auth login` again).
 */
export async function refreshToken(chrome) {
    const session = await chrome.fetchSession();
    if (!session.accessToken) {
        throw new SessionExpiredError("ChatGPT session expired. Run `pi-chatgpt-web auth login` to re-authenticate.");
    }
    const state = authStateFromToken(session.accessToken);
    writeAuthState(state);
    log.info("token refreshed", {
        email: state.account.email,
        expInSec: secondsUntilExpiry(state.accessToken),
    });
    return state;
}
/**
 * Return a valid token, refreshing through the browser only when within the
 * skew window of expiry. Used on the hot path before each chat call.
 */
export async function ensureFreshToken(chrome, skewSeconds = REFRESH_SKEW_SECONDS) {
    const state = readAuthState();
    if (!state) {
        throw new SessionExpiredError("Not logged in. Run `pi-chatgpt-web auth login` first.");
    }
    const ttl = secondsUntilExpiry(state.accessToken);
    if (ttl > skewSeconds)
        return state.accessToken;
    log.info("token near expiry, refreshing", { ttl });
    const refreshed = await refreshToken(chrome);
    return refreshed.accessToken;
}
//# sourceMappingURL=refresh.js.map