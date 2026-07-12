import { mkdirSync } from "node:fs";
import { CHATGPT_ORIGIN, PATHS, ROUTES } from "../constants.js";
import { createLogger } from "../log.js";
import { SENTINEL_GLOBAL, installSentinelHook } from "./hooks.js";
import { requireChromePath } from "./chrome-path.js";
const log = createLogger("browser");
export class ManagedChrome {
    browser = null;
    page = null;
    puppeteer = null;
    booting = null;
    cdp = null;
    fetchInit = null;
    mintResolve = null;
    minting = null;
    headless;
    constructor(opts = {}) {
        // Default to headful: the sentinel SDK + composer do not render reliably in
        // (new) headless Chrome, which breaks token minting. Opt into headless via
        // PI_CHATGPT_WEB_HEADLESS=1 only for experimentation.
        this.headless = opts.headless ?? false;
    }
    async loadPuppeteer() {
        if (this.puppeteer)
            return this.puppeteer;
        try {
            const mod = await import("puppeteer-core");
            this.puppeteer = (mod.default ?? mod);
        }
        catch (err) {
            throw new Error("puppeteer-core is not installed. Run `npm install` in the package " +
                `directory. (${err.message})`);
        }
        return this.puppeteer;
    }
    async ensureRunning() {
        if (this.page && !this.page.isClosed())
            return this.page;
        if (this.booting)
            return this.booting;
        this.booting = this.boot().finally(() => {
            this.booting = null;
        });
        return this.booting;
    }
    async boot() {
        const puppeteer = await this.loadPuppeteer();
        const profileDir = PATHS.profileDir();
        mkdirSync(profileDir, { recursive: true });
        const executablePath = requireChromePath();
        log.info("launching browser", { executablePath, profileDir, headless: this.headless });
        this.browser = await puppeteer.launch({
            headless: this.headless,
            executablePath,
            userDataDir: profileDir,
            args: [
                "--no-first-run",
                "--no-default-browser-check",
                "--password-store=basic",
                "--disable-blink-features=AutomationControlled",
                "--disable-features=Translate,site-per-process",
            ],
            defaultViewport: { width: 1280, height: 900 },
        });
        this.browser.on("disconnected", () => {
            log.warn("browser disconnected");
            this.browser = null;
            this.page = null;
            this.cdp = null;
            this.fetchInit = null;
            this.mintResolve = null;
        });
        const page = (await this.browser.pages())[0] ?? (await this.browser.newPage());
        await page.evaluateOnNewDocument(installSentinelHook, SENTINEL_GLOBAL);
        await page.goto(`${CHATGPT_ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        this.page = page;
        return page;
    }
    /** Launch a visible window for interactive login. */
    async openForLogin() {
        return this.ensureRunning();
    }
    /** Read /api/auth/session inside the page (uses the live cookies). */
    async fetchSession() {
        const page = await this.ensureRunning();
        const result = (await page.evaluate(async (route) => {
            try {
                const res = await fetch(route, {
                    headers: { accept: "application/json" },
                    credentials: "include",
                });
                if (!res.ok)
                    return { ok: false, status: res.status, body: null };
                const body = await res.json();
                return { ok: true, status: res.status, body };
            }
            catch (e) {
                return { ok: false, status: 0, body: null, error: String(e) };
            }
        }, ROUTES.authSession));
        const body = result.body;
        const accessToken = body?.accessToken ?? body?.access_token ?? body?.user?.accessToken ?? null;
        return {
            accessToken,
            email: body?.user?.email,
            expires: body?.expires,
            raw: body,
        };
    }
    /** Poll until /api/auth/session returns a JWT or the deadline passes. */
    async waitForLogin(timeoutMs, onTick) {
        const start = Date.now();
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const session = await this.fetchSession();
            if (session.accessToken)
                return session;
            const elapsed = Date.now() - start;
            if (elapsed > timeoutMs) {
                return session; // caller decides; accessToken is null
            }
            onTick?.(elapsed);
            await delay(2000);
        }
    }
    /**
     * Ensure a single CDP session is intercepting POST /f/conversation at the
     * Request stage. During a mint we capture-and-abort the SPA's own request;
     * all other intercepted requests (including our daemon's real conversation
     * call) are passed straight through.
     */
    async ensureFetchInterception() {
        if (this.fetchInit)
            return this.fetchInit;
        this.fetchInit = (async () => {
            const page = await this.ensureRunning();
            const cdp = await page.target().createCDPSession();
            await cdp.send("Fetch.enable", {
                patterns: [{ urlPattern: "*://chatgpt.com/backend-api/f/conversation", requestStage: "Request" }],
            });
            cdp.on("Fetch.requestPaused", (ev) => {
                void this.onRequestPaused(cdp, ev);
            });
            this.cdp = cdp;
        })().catch((err) => {
            this.fetchInit = null;
            throw err;
        });
        return this.fetchInit;
    }
    async onRequestPaused(cdp, ev) {
        const { requestId } = ev;
        const path = String(ev.request?.url || "").split("?")[0] ?? "";
        if (this.mintResolve && path.endsWith("/f/conversation")) {
            const resolve = this.mintResolve;
            this.mintResolve = null;
            const headers = lowerKeys(ev.request.headers || {});
            // Abort before it reaches the server: no turn consumed, no history entry.
            try {
                await cdp.send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
            }
            catch {
                /* ignore */
            }
            resolve(headers);
            return;
        }
        // Not a mint trigger (e.g. our own real request): let it through unchanged.
        try {
            await cdp.send("Fetch.continueRequest", { requestId });
        }
        catch {
            /* ignore */
        }
    }
    /**
     * Mint a fresh, valid sentinel header set by letting the real ChatGPT SPA
     * generate it. We trigger a send via the composer, intercept the outgoing
     * /f/conversation request at the CDP layer, snapshot its fully-minted headers
     * (the OpenAI-Sentinel-* triple + OAI-* identity + X-OpenAI-Target-* routing),
     * then abort the request before it reaches the server. This delegates the
     * proof-of-work / turnstile to OpenAI's own (rotating) sentinel SDK, so it
     * survives frontend changes without us porting the algorithm.
     *
     * No caching: requirements tokens are single-use, so every turn mints fresh.
     */
    async mintSentinelHeaders() {
        if (this.minting)
            return this.minting;
        this.minting = this.doMint().finally(() => {
            this.minting = null;
        });
        return this.minting;
    }
    async doMint() {
        await this.ensureFetchInterception();
        const page = await this.ensureRunning();
        await this.ensureComposer(page);
        let timer;
        const captured = new Promise((resolve) => {
            this.mintResolve = (headers) => {
                if (timer)
                    clearTimeout(timer);
                resolve(headers);
            };
        });
        try {
            await page.click("#prompt-textarea").catch(() => { });
            await page.keyboard.type("ping", { delay: 8 });
            await page.keyboard.press("Enter");
            const raw = await new Promise((resolve, reject) => {
                timer = setTimeout(() => {
                    this.mintResolve = null;
                    reject(new Error("sentinel mint timed out (composer send not observed)"));
                }, 30_000);
                captured.then(resolve, reject);
            });
            return { headers: filterSentinelHeaders(raw), capturedAt: Date.now() };
        }
        finally {
            if (timer)
                clearTimeout(timer);
            this.mintResolve = null;
            await this.clearComposer(page).catch(() => { });
        }
    }
    async ensureComposer(page) {
        if (!/^https:\/\/chatgpt\.com\/?($|\?)/.test(page.url())) {
            await page
                .goto(`${CHATGPT_ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: 60_000 })
                .catch(() => { });
        }
        await page.waitForSelector("#prompt-textarea", { timeout: 30_000 });
    }
    async clearComposer(page) {
        await page.click("#prompt-textarea").catch(() => { });
        await page.keyboard.down("Meta");
        await page.keyboard.press("A");
        await page.keyboard.up("Meta");
        await page.keyboard.press("Backspace");
    }
    /** Read the latest captured sentinel/bearer/conduit state without minting. */
    async readCaptured() {
        const page = await this.ensureRunning();
        return (await page.evaluate((globalKey) => {
            const w = window;
            return w[globalKey] || {};
        }, SENTINEL_GLOBAL));
    }
    /** Keep the anti-bot score warm; mirrors the SPA's heartbeat. */
    async ping() {
        try {
            const page = await this.ensureRunning();
            return (await page.evaluate(async (route) => {
                try {
                    const res = await fetch(route, { method: "POST", credentials: "include" });
                    return res.ok;
                }
                catch {
                    return false;
                }
            }, ROUTES.sentinelPing));
        }
        catch {
            return false;
        }
    }
    /** Run an arbitrary fetch inside the page context (used by Strategy B). */
    async pageContext() {
        return this.ensureRunning();
    }
    async close() {
        try {
            await this.browser?.close();
        }
        catch {
            /* ignore */
        }
        this.browser = null;
        this.page = null;
        this.cdp = null;
        this.fetchInit = null;
        this.mintResolve = null;
    }
}
function lowerKeys(headers) {
    const out = {};
    for (const [k, v] of Object.entries(headers))
        out[k.toLowerCase()] = String(v);
    return out;
}
/** Headers the caller (re)sets per request; never reuse the captured copies. */
const STRIP_HEADERS = new Set([
    "content-length",
    "accept-encoding",
    "connection",
    "host",
    "cookie",
    "content-type",
    "accept",
    "authorization",
    "x-oai-turn-trace-id",
]);
function filterSentinelHeaders(headers) {
    const out = {};
    for (const [k, v] of Object.entries(headers)) {
        if (STRIP_HEADERS.has(k))
            continue;
        out[k] = v;
    }
    return out;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=supervisor.js.map