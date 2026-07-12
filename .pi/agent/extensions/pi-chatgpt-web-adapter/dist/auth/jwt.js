/**
 * Minimal, dependency-free JWT *decoding* (NOT verification).
 *
 * We only ever read claims from a token chatgpt.com already minted for us; we
 * never validate signatures (the server does that). Decoding lets us read the
 * expiry and account metadata for the local hot cache + `auth status`.
 */
function b64urlDecode(input) {
    const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
    const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
    return Buffer.from(b64, "base64").toString("utf8");
}
export function decodeJwt(token) {
    const parts = token.split(".");
    if (parts.length < 2 || !parts[1]) {
        throw new Error("not a JWT (missing payload segment)");
    }
    let payload;
    try {
        payload = JSON.parse(b64urlDecode(parts[1]));
    }
    catch (err) {
        throw new Error(`failed to decode JWT payload: ${err.message}`);
    }
    const authNs = (payload["https://api.openai.com/auth"] ?? {});
    const scp = payload["scp"];
    const scopes = Array.isArray(scp)
        ? scp.map(String)
        : typeof scp === "string"
            ? scp.split(/\s+/).filter(Boolean)
            : undefined;
    return {
        exp: typeof payload["exp"] === "number" ? payload["exp"] : undefined,
        iat: typeof payload["iat"] === "number" ? payload["iat"] : undefined,
        email: payload["email"] ??
            authNs["email"],
        userId: authNs["chatgpt_user_id"] ??
            authNs["user_id"] ??
            payload["sub"],
        accountId: authNs["chatgpt_account_id"],
        planType: authNs["chatgpt_plan_type"],
        scopes,
        raw: payload,
    };
}
/** Seconds until expiry; negative if already expired; +Infinity if unknown. */
export function secondsUntilExpiry(token, now = Date.now()) {
    try {
        const { exp } = decodeJwt(token);
        if (!exp)
            return Number.POSITIVE_INFINITY;
        return exp - Math.floor(now / 1000);
    }
    catch {
        return Number.NEGATIVE_INFINITY;
    }
}
export function hasModelRequestScope(token) {
    try {
        const { scopes } = decodeJwt(token);
        return !!scopes?.includes("model.request");
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=jwt.js.map