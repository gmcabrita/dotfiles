import { CHATGPT_ORIGIN, PATHS } from "../constants.js";
import { createLogger } from "../log.js";
import { ManagedChrome } from "../browser/supervisor.js";
import { hasModelRequestScope } from "./jwt.js";
import { authStateFromToken, writeAuthState } from "./store.js";
const log = createLogger("login");
/**
 * Interactive login: opens a VISIBLE Chromium window pointed at the ChatGPT
 * login page, waits for the user to complete whatever auth method they like,
 * then captures the resulting JWT from /api/auth/session and persists it.
 *
 * No HAR import, no pasted tokens — the only way credentials enter the system.
 */
export async function runLogin(options = {}) {
    const timeoutMs = options.timeoutMs ?? 5 * 60_000;
    const chrome = new ManagedChrome({ headless: false });
    const warnings = [];
    try {
        const page = await chrome.openForLogin();
        // If we're already logged in, /api/auth/session returns a token immediately.
        const existing = await chrome.fetchSession();
        if (!existing.accessToken) {
            await page.goto(`${CHATGPT_ORIGIN}/auth/login`, { waitUntil: "domcontentloaded" }).catch(() => { });
            process.stdout.write(`\nOpening Chromium for login.\nProfile: ${PATHS.profileDir()}\n\n` +
                "Complete login in the browser window (Google, Microsoft, email — any method).\n" +
                "Waiting for a valid session...\n");
        }
        const session = await chrome.waitForLogin(timeoutMs, (elapsed) => {
            if (elapsed % 20_000 < 2100)
                log.info("still waiting for login", { elapsedMs: elapsed });
        });
        if (!session.accessToken) {
            throw new Error("Timed out waiting for login. Re-run `pi-chatgpt-web auth login` and " +
                "finish signing in within the window.");
        }
        if (!hasModelRequestScope(session.accessToken)) {
            warnings.push("Captured token lacks the `model.request` scope. The chat endpoint may " +
                "reject it. This can happen if ChatGPT changed its web client; please report.");
        }
        const state = authStateFromToken(session.accessToken);
        writeAuthState(state);
        log.info("login captured", { email: state.account.email, plan: state.account.planType });
        // Warm the sentinel oracle once to validate the page can mint tokens.
        await chrome
            .mintSentinelHeaders()
            .catch(() => warnings.push("Sentinel warm-up did not complete; will retry on first use."));
        return { state, warnings };
    }
    finally {
        await chrome.close();
    }
}
//# sourceMappingURL=login.js.map