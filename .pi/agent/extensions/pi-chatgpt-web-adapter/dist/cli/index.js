import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ADVERTISED_MODELS, DEFAULT_HOST, DEFAULT_PORT, PATHS, REFRESH_SKEW_SECONDS, } from "../constants.js";
import { authHealth, readAuthState } from "../auth/store.js";
import { secondsUntilExpiry } from "../auth/jwt.js";
const require = createRequire(import.meta.url);
function version() {
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        const pkg = require(join(here, "..", "..", "package.json"));
        return pkg.version ?? "0.0.0";
    }
    catch {
        return "0.0.0";
    }
}
function printHelp() {
    process.stdout.write(`pi-chatgpt-web ${version()} — ChatGPT web (gpt-5.5-pro) adapter for Pi\n\n` +
        "Usage:\n" +
        "  pi-chatgpt-web auth login         Open a browser and capture a ChatGPT session\n" +
        "  pi-chatgpt-web auth status        Show account + token expiry\n" +
        "  pi-chatgpt-web auth refresh       Force a token refresh via the warm tab\n" +
        "  pi-chatgpt-web serve [--port N]   Run the local OpenAI-compatible daemon\n" +
        "  pi-chatgpt-web chat <prompt>      One-shot chat (requires login)\n" +
        "  pi-chatgpt-web doctor             Health check\n" +
        "  pi-chatgpt-web install-agent      Install macOS LaunchAgent for the daemon\n" +
        "  pi-chatgpt-web uninstall-agent    Remove the LaunchAgent\n" +
        "  pi-chatgpt-web --version          Print version\n\n" +
        "Env:\n" +
        "  PI_CHATGPT_WEB_PORT, PI_CHATGPT_WEB_CHROME, PI_CHATGPT_WEB_HEADLESS=1 (experimental)\n");
}
function fmtDuration(sec) {
    if (!Number.isFinite(sec))
        return "unknown";
    if (sec <= 0)
        return "expired";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0)
        return `${h}h ${m}m`;
    return `${m}m`;
}
async function cmdAuthStatus() {
    const state = readAuthState();
    if (!state) {
        process.stdout.write("not logged in — run `pi-chatgpt-web auth login`\n");
        return 1;
    }
    const ttl = secondsUntilExpiry(state.accessToken);
    process.stdout.write(`account: ${state.account.email ?? "unknown"} (plan: ${state.account.planType ?? "?"})\n` +
        `token expires in: ${fmtDuration(ttl)}\n` +
        `profile: ${state.profileDir}\n` +
        `auth file: ${PATHS.authFile()}\n`);
    return ttl > 0 ? 0 : 1;
}
async function cmdLogin() {
    const { runLogin } = await import("../auth/login.js");
    const result = await runLogin();
    process.stdout.write(`\n✓ logged in as ${result.state.account.email ?? "unknown"} ` +
        `(plan: ${result.state.account.planType ?? "?"})\n` +
        `✓ token expires in ${fmtDuration(secondsUntilExpiry(result.state.accessToken))}\n` +
        `✓ auth saved to ${PATHS.authFile()}\n`);
    for (const w of result.warnings)
        process.stdout.write(`  ! ${w}\n`);
    return 0;
}
async function cmdRefresh() {
    const { ManagedChrome } = await import("../browser/supervisor.js");
    const { refreshToken } = await import("../auth/refresh.js");
    const chrome = new ManagedChrome({ headless: resolveHeadless() });
    try {
        const state = await refreshToken(chrome);
        process.stdout.write(`✓ refreshed; expires in ${fmtDuration(secondsUntilExpiry(state.accessToken))}\n`);
        return 0;
    }
    finally {
        await chrome.close();
    }
}
async function cmdServe(args) {
    const { AdapterServer } = await import("../server/http.js");
    const { writeRuntime, clearRuntime } = await import("../server/runtime.js");
    const portArg = argValue(args, "--port");
    const port = portArg ? Number(portArg) : Number(process.env.PI_CHATGPT_WEB_PORT) || DEFAULT_PORT;
    const host = argValue(args, "--host") || DEFAULT_HOST;
    const server = new AdapterServer({ host, port, headless: resolveHeadless() });
    const { host: h, port: p } = await server.listen();
    writeRuntime({ host: h, port: p, pid: process.pid, startedAt: Date.now() });
    process.stdout.write(`pi-chatgpt-web serving OpenAI-compatible API on http://${h}:${p}/v1\n`);
    const shutdown = async () => {
        clearRuntime();
        await server.close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return new Promise(() => { }); // run forever
}
async function cmdChat(args) {
    const prompt = args.filter((a) => !a.startsWith("--")).join(" ");
    if (!prompt) {
        process.stderr.write("usage: pi-chatgpt-web chat <prompt> [--model M] [--effort standard|extended]\n");
        return 2;
    }
    const model = argValue(args, "--model") || ADVERTISED_MODELS[0];
    const effort = argValue(args, "--effort") || "standard";
    const { ManagedChrome } = await import("../browser/supervisor.js");
    const { ChatClient } = await import("../chat/conversation.js");
    const { ensureFreshToken } = await import("../auth/refresh.js");
    const chrome = new ManagedChrome({ headless: resolveHeadless() });
    try {
        const bearer = await ensureFreshToken(chrome);
        const chat = new ChatClient(chrome);
        process.stderr.write(`… asking ${model} (effort: ${effort})\n`);
        const result = await chat.run({
            prompt,
            model,
            effort,
            onHeartbeat: () => process.stderr.write("."),
        }, bearer);
        if (result.reasoning)
            process.stderr.write(`\n[reasoning]\n${result.reasoning}\n`);
        process.stdout.write(`\n${result.text}\n`);
        return result.text ? 0 : 1;
    }
    finally {
        await chrome.close();
    }
}
async function cmdDoctor(args = []) {
    const health = authHealth(REFRESH_SKEW_SECONDS);
    const lines = ["pi-chatgpt-web doctor", "─────────────────────"];
    lines.push(`version: ${version()}`);
    if (!health.present) {
        lines.push("auth: ✗ not logged in — run `pi-chatgpt-web auth login`");
    }
    else if (health.expired) {
        lines.push(`auth: ✗ token expired (${health.email ?? "?"}) — run \`auth login\``);
    }
    else {
        lines.push(`auth: ✓ ${health.email ?? "?"} (plan: ${health.planType ?? "?"}), ` +
            `expires in ${fmtDuration(health.expiresInSeconds ?? NaN)}` +
            (health.needsRefresh ? " (refresh due)" : ""));
    }
    try {
        const { findChromePath } = await import("../browser/chrome-path.js");
        const chrome = findChromePath();
        lines.push(chrome ? `browser: ✓ ${chrome}` : "browser: ✗ no Chromium found (set PI_CHATGPT_WEB_CHROME)");
    }
    catch (err) {
        lines.push(`browser: ✗ ${err.message}`);
    }
    try {
        const { probeDaemon } = await import("../server/runtime.js");
        const info = await probeDaemon();
        lines.push(info ? `daemon: ✓ live on ${info.baseUrl} (pid ${info.pid})` : "daemon: – not running");
    }
    catch {
        lines.push("daemon: – not running");
    }
    if ((args.includes("--probe") || args.includes("--sentinel")) && health.present && !health.expired) {
        try {
            const { ManagedChrome } = await import("../browser/supervisor.js");
            const chrome = new ManagedChrome({ headless: resolveHeadless() });
            try {
                const set = await chrome.mintSentinelHeaders();
                const h = set.headers;
                const ok = Boolean(h["openai-sentinel-chat-requirements-token"]) &&
                    Boolean(h["openai-sentinel-proof-token"]) &&
                    Boolean(h["openai-sentinel-turnstile-token"]);
                lines.push(ok
                    ? "sentinel: ✓ minted requirements + proof + turnstile"
                    : `sentinel: ✗ mint incomplete (keys: ${Object.keys(h).join(", ")})`);
            }
            finally {
                await chrome.close();
            }
        }
        catch (err) {
            lines.push(`sentinel: ✗ ${err.message}`);
        }
    }
    process.stdout.write(lines.join("\n") + "\n");
    return health.present && !health.expired ? 0 : 1;
}
/**
 * Headful by default (the sentinel SDK + composer need a real-rendered page to
 * mint tokens). Set PI_CHATGPT_WEB_HEADLESS=1 to experiment with headless.
 */
function resolveHeadless() {
    return process.env.PI_CHATGPT_WEB_HEADLESS === "1";
}
function argValue(args, flag) {
    const i = args.indexOf(flag);
    if (i !== -1 && i + 1 < args.length)
        return args[i + 1];
    const eq = args.find((a) => a.startsWith(flag + "="));
    return eq ? eq.slice(flag.length + 1) : undefined;
}
async function main() {
    const argv = process.argv.slice(2);
    const cmd = argv[0];
    const rest = argv.slice(1);
    let code = 0;
    switch (cmd) {
        case "--version":
        case "-v":
            process.stdout.write(version() + "\n");
            break;
        case undefined:
        case "--help":
        case "-h":
        case "help":
            printHelp();
            break;
        case "auth":
            if (rest[0] === "login")
                code = await cmdLogin();
            else if (rest[0] === "status")
                code = await cmdAuthStatus();
            else if (rest[0] === "refresh")
                code = await cmdRefresh();
            else {
                process.stderr.write("usage: pi-chatgpt-web auth <login|status|refresh>\n");
                code = 2;
            }
            break;
        case "serve":
            code = await cmdServe(rest);
            break;
        case "chat":
            code = await cmdChat(rest);
            break;
        case "doctor":
            code = await cmdDoctor(rest);
            break;
        case "install-agent": {
            const { installLaunchAgent } = await import("../server/launch-agent.js");
            const portArg = argValue(rest, "--port");
            const p = installLaunchAgent(portArg ? Number(portArg) : undefined);
            process.stdout.write(`✓ LaunchAgent installed + loaded: ${p}\n`);
            break;
        }
        case "uninstall-agent": {
            const { uninstallLaunchAgent } = await import("../server/launch-agent.js");
            const p = uninstallLaunchAgent();
            process.stdout.write(p ? `✓ LaunchAgent removed: ${p}\n` : "no LaunchAgent installed\n");
            break;
        }
        default:
            process.stderr.write(`unknown command: ${cmd}\n`);
            printHelp();
            code = 2;
    }
    process.exit(code);
}
main().catch((err) => {
    process.stderr.write(`pi-chatgpt-web: ${err?.stack || err}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map