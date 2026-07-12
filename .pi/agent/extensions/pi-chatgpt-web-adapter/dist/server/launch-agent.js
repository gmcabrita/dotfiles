import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DEFAULT_PORT, PATHS } from "../constants.js";
const LABEL = "ai.pi.chatgpt-web-adapter";
function plistPath() {
    return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}
function binPath() {
    // dist/server/launch-agent.js → ../../bin/pi-chatgpt-web.mjs
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, "..", "..", "bin", "pi-chatgpt-web.mjs");
}
function xmlEscape(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
function renderPlist(port) {
    const logDir = PATHS.logDir();
    const nodePath = xmlEscape(process.execPath);
    const adapterBinPath = xmlEscape(binPath());
    const portText = xmlEscape(port);
    const stdoutPath = xmlEscape(join(logDir, "launchd.out.log"));
    const stderrPath = xmlEscape(join(logDir, "launchd.err.log"));
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${adapterBinPath}</string>
    <string>serve</string>
    <string>--port</string>
    <string>${portText}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${stdoutPath}</string>
  <key>StandardErrorPath</key><string>${stderrPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PI_CHATGPT_WEB_PORT</key><string>${portText}</string>
  </dict>
</dict>
</plist>
`;
}
export function installLaunchAgent(port = DEFAULT_PORT) {
    if (platform() !== "darwin") {
        throw new Error("install-agent is macOS-only. On Linux, create a systemd user unit for `pi-chatgpt-web serve`.");
    }
    mkdirSync(PATHS.logDir(), { recursive: true });
    const path = plistPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderPlist(port));
    try {
        execFileSync("launchctl", ["unload", path], { stdio: "ignore" });
    }
    catch {
        /* not loaded yet */
    }
    execFileSync("launchctl", ["load", path], { stdio: "ignore" });
    return path;
}
export function uninstallLaunchAgent() {
    if (platform() !== "darwin")
        return null;
    const path = plistPath();
    if (!existsSync(path))
        return null;
    try {
        execFileSync("launchctl", ["unload", path], { stdio: "ignore" });
    }
    catch {
        /* ignore */
    }
    rmSync(path);
    return path;
}
//# sourceMappingURL=launch-agent.js.map