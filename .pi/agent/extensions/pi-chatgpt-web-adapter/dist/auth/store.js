import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, } from "node:fs";
import { dirname } from "node:path";
import { PATHS } from "../constants.js";
import { decodeJwt, secondsUntilExpiry } from "./jwt.js";
const AUTH_FILE_MODE = 0o600;
export function authFileExists() {
    return existsSync(PATHS.authFile());
}
export function readAuthState() {
    const file = PATHS.authFile();
    if (!existsSync(file))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        if (!parsed || typeof parsed.accessToken !== "string")
            return null;
        return {
            version: 1,
            profileDir: parsed.profileDir ?? PATHS.profileDir(),
            account: parsed.account ?? {},
            accessToken: parsed.accessToken,
            accessTokenExp: parsed.accessTokenExp ?? 0,
            refreshedAt: parsed.refreshedAt ?? 0,
            lastSessionCheck: parsed.lastSessionCheck ?? 0,
        };
    }
    catch {
        return null;
    }
}
/** Build an AuthState from a freshly captured JWT. */
export function authStateFromToken(token, now = Date.now()) {
    const claims = decodeJwt(token);
    const nowSec = Math.floor(now / 1000);
    return {
        version: 1,
        profileDir: PATHS.profileDir(),
        account: {
            email: claims.email,
            userId: claims.userId,
            accountId: claims.accountId,
            planType: claims.planType,
        },
        accessToken: token,
        accessTokenExp: claims.exp ?? 0,
        refreshedAt: nowSec,
        lastSessionCheck: nowSec,
    };
}
/** Atomic, mode-600 write. */
export function writeAuthState(state) {
    const file = PATHS.authFile();
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: AUTH_FILE_MODE });
    chmodSync(tmp, AUTH_FILE_MODE);
    renameSync(tmp, file);
    // rename can preserve old perms on some FS; re-assert.
    try {
        chmodSync(file, AUTH_FILE_MODE);
    }
    catch {
        /* best effort */
    }
}
export function authHealth(skewSeconds, now = Date.now()) {
    const state = readAuthState();
    if (!state)
        return { present: false, expired: true, needsRefresh: true };
    const ttl = secondsUntilExpiry(state.accessToken, now);
    return {
        present: true,
        email: state.account.email,
        planType: state.account.planType,
        expiresInSeconds: Number.isFinite(ttl) ? ttl : undefined,
        expired: ttl <= 0,
        needsRefresh: ttl <= skewSeconds,
    };
}
//# sourceMappingURL=store.js.map