import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { platform } from "node:os";
/**
 * Locate a usable Chromium-family executable. We never bundle Chromium
 * (puppeteer-core has none); we reuse whatever the user already has.
 */
const MAC_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
const LINUX_CANDIDATES = [
    "google-chrome-stable",
    "google-chrome",
    "chromium",
    "chromium-browser",
    "brave-browser",
    "microsoft-edge",
];
const WINDOWS_CANDIDATES = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
function which(cmd) {
    try {
        const out = execFileSync(process.platform === "win32" ? "where" : "which", [cmd], {
            stdio: ["ignore", "pipe", "ignore"],
        })
            .toString()
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
        return out[0] ?? null;
    }
    catch {
        return null;
    }
}
export function findChromePath() {
    const override = process.env.PI_CHATGPT_WEB_CHROME || process.env.CHROME_PATH;
    if (override && existsSync(override))
        return override;
    const os = platform();
    if (os === "darwin") {
        for (const p of MAC_CANDIDATES)
            if (existsSync(p))
                return p;
    }
    else if (os === "win32") {
        for (const p of WINDOWS_CANDIDATES)
            if (existsSync(p))
                return p;
        for (const c of ["chrome", "msedge"]) {
            const resolved = which(c);
            if (resolved)
                return resolved;
        }
    }
    else {
        for (const c of LINUX_CANDIDATES) {
            if (c.startsWith("/")) {
                if (existsSync(c))
                    return c;
            }
            else {
                const resolved = which(c);
                if (resolved)
                    return resolved;
            }
        }
    }
    return null;
}
export function requireChromePath() {
    const p = findChromePath();
    if (!p) {
        throw new Error("No Chromium-family browser found. Install Google Chrome, Chromium, " +
            "Brave, or Edge, or set PI_CHATGPT_WEB_CHROME=/path/to/browser.");
    }
    return p;
}
//# sourceMappingURL=chrome-path.js.map