/**
 * Early in-page hook installed via `page.evaluateOnNewDocument`. It runs before
 * the ChatGPT React app boots and wraps `window.fetch` so that whenever the SPA
 * makes its own authenticated calls, we passively capture:
 *   - the three OpenAI-Sentinel-* tokens it injects as request headers
 *   - the latest bearer JWT from the Authorization header
 *   - the conduit token from /f/conversation/prepare responses
 *
 * Passive capture (vs us forging the proof-of-work) is what makes this durable
 * across frontend rotations: the real app keeps minting valid tokens and we
 * just read them.
 */
// The global key the hook writes into and the supervisor reads from.
export const SENTINEL_GLOBAL = "__piSentinel";
/**
 * Serialized into the page. Must be fully self-contained (no closures over
 * Node-side variables) because puppeteer stringifies it.
 */
export function installSentinelHook(globalKey) {
    const w = window;
    if (w[globalKey]?.__installed)
        return;
    const store = {
        __installed: true,
        requirements: null,
        turnstile: null,
        proof: null,
        bearer: null,
        conduit: null,
        updatedAt: 0,
    };
    w[globalKey] = store;
    const readHeader = (headers, name) => {
        if (!headers)
            return null;
        const lower = name.toLowerCase();
        try {
            if (typeof headers.get === "function") {
                return headers.get(name) ?? headers.get(lower) ?? null;
            }
            if (Array.isArray(headers)) {
                for (const pair of headers) {
                    if (Array.isArray(pair) && String(pair[0]).toLowerCase() === lower) {
                        return String(pair[1]);
                    }
                }
                return null;
            }
            for (const k of Object.keys(headers)) {
                if (k.toLowerCase() === lower)
                    return String(headers[k]);
            }
        }
        catch {
            /* ignore */
        }
        return null;
    };
    const origFetch = w.fetch.bind(w);
    w.fetch = async function (resource, init) {
        try {
            const headers = (init && init.headers) || (resource && resource.headers);
            const req = readHeader(headers, "openai-sentinel-chat-requirements-token");
            const turn = readHeader(headers, "openai-sentinel-turnstile-token");
            const proof = readHeader(headers, "openai-sentinel-proof-token");
            const auth = readHeader(headers, "authorization");
            if (req)
                store.requirements = req;
            if (turn)
                store.turnstile = turn;
            if (proof)
                store.proof = proof;
            if (auth && /^Bearer\s+/i.test(auth))
                store.bearer = auth.replace(/^Bearer\s+/i, "");
            if (req || turn || proof)
                store.updatedAt = Date.now();
        }
        catch {
            /* never break the page */
        }
        const res = await origFetch(resource, init);
        try {
            const url = typeof resource === "string" ? resource : resource?.url || "";
            if (url.includes("/backend-api/f/conversation/prepare") && res.ok) {
                const clone = res.clone();
                clone
                    .json()
                    .then((body) => {
                    if (body && body.conduit_token)
                        store.conduit = body.conduit_token;
                })
                    .catch(() => { });
            }
        }
        catch {
            /* ignore */
        }
        return res;
    };
}
//# sourceMappingURL=hooks.js.map