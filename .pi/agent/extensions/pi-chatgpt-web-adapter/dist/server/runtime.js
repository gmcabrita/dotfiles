import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_HOST, DEFAULT_PORT, PATHS } from "../constants.js";
export function writeRuntime(info) {
    const file = PATHS.runtimeFile();
    mkdirSync(dirname(file), { recursive: true });
    const full = { ...info, baseUrl: `http://${info.host}:${info.port}/v1` };
    writeFileSync(file, JSON.stringify(full, null, 2));
    return full;
}
export function readRuntime() {
    const file = PATHS.runtimeFile();
    if (!existsSync(file))
        return null;
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    }
    catch {
        return null;
    }
}
export function clearRuntime() {
    const file = PATHS.runtimeFile();
    try {
        if (existsSync(file))
            rmSync(file);
    }
    catch {
        /* ignore */
    }
}
export function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
/** Is a daemon currently live (runtime file present + pid alive + port reachable)? */
export async function probeDaemon() {
    const info = readRuntime();
    if (!info)
        return null;
    if (!pidAlive(info.pid)) {
        clearRuntime();
        return null;
    }
    try {
        const res = await fetch(`http://${info.host}:${info.port}/health`, {
            signal: AbortSignal.timeout(2000),
        });
        if (res.ok)
            return info;
    }
    catch {
        /* not reachable */
    }
    return null;
}
export const DEFAULTS = { host: DEFAULT_HOST, port: DEFAULT_PORT };
//# sourceMappingURL=runtime.js.map