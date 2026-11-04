#!/usr/bin/env node

// Dependency-free Chrome DevTools Protocol CLI for Node.js 22+.

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import net from "node:net";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectWebSocket } from "./lib/websocket.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const DEFAULT_TIMEOUT = 15_000;
const IDLE_TIMEOUT = 20 * 60_000;
// Chrome holds the WebSocket upgrade open until the user answers its "Allow
// debugging" prompt, so local connections get time for a human to respond.
const APPROVAL_TIMEOUT = 120_000;
const APPROVAL_NOTICE_DELAY = 2_000;
const MIN_PREFIX = 8;
const STATE_PREFIX = "faster-cdp-";
const VERSION = "0.1.0";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseOptions(argv) {
	const options = {
		wsEndpoint: process.env.CDP_WS_ENDPOINT,
		httpEndpoint: process.env.CDP_HTTP_ENDPOINT,
		headers: process.env.CDP_HEADERS ? JSON.parse(process.env.CDP_HEADERS) : {},
		timeout: DEFAULT_TIMEOUT,
	};
	const args = [];
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i];
		if (value === "--ws-endpoint") options.wsEndpoint = argv[++i];
		else if (value === "--http-endpoint") options.httpEndpoint = argv[++i];
		else if (value === "--headers") options.headers = JSON.parse(argv[++i]);
		else if (value === "--timeout")
			options.timeout = positiveInteger(argv[++i], "--timeout");
		else if (value === "--help" || value === "-h") options.help = true;
		else if (value === "--version" || value === "-v") options.version = true;
		else args.push(value);
	}
	return { options, args };
}

function positiveInteger(value, name) {
	const number = Number(value);
	if (!Number.isInteger(number) || number <= 0)
		throw new Error(`${name} must be a positive integer`);
	return number;
}

function positiveIntegerAtMost(value, name, maximum) {
	const number = positiveInteger(value, name);
	if (number > maximum) throw new Error(`${name} must be at most ${maximum}`);
	return number;
}

function activePortCandidates() {
	const home = homedir();
	if (platform() === "darwin") {
		return [
			join(
				home,
				"Library/Application Support/net.imput.helium/DevToolsActivePort",
			),
		];
	}
	if (platform() === "win32") {
		const local = process.env.LOCALAPPDATA;
		return local
			? [join(local, "Google/Chrome/User Data/DevToolsActivePort")]
			: [];
	}
	return [
		join(home, ".config/google-chrome/DevToolsActivePort"),
		join(home, ".config/google-chrome-beta/DevToolsActivePort"),
		join(home, ".config/chromium/DevToolsActivePort"),
	];
}

async function endpointFromHttp(httpEndpoint, headers, timeout) {
	const base = httpEndpoint.replace(/\/$/, "");
	const response = await fetch(`${base}/json/version`, {
		headers,
		signal: AbortSignal.timeout(timeout),
	});
	if (!response.ok)
		throw new Error(`CDP discovery failed: HTTP ${response.status}`);
	const info = await response.json();
	if (!info.webSocketDebuggerUrl)
		throw new Error("CDP discovery response has no webSocketDebuggerUrl");
	return info.webSocketDebuggerUrl;
}

function portOpen(port, timeout = 1_000) {
	return new Promise((resolve) => {
		const socket = net.connect({ host: "127.0.0.1", port });
		const done = (open) => {
			socket.destroy();
			resolve(open);
		};
		socket.setTimeout(timeout, () => done(false));
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
	});
}

// Chrome's built-in remote debugging (chrome://inspect) can listen on a port
// without writing DevToolsActivePort and with HTTP discovery disabled, while
// still accepting the browser WebSocket at /devtools/browser.
async function localPortEndpoint(port, headers) {
	try {
		return await endpointFromHttp(`http://127.0.0.1:${port}`, headers, 1_000);
	} catch {}
	if (await portOpen(port)) return `ws://127.0.0.1:${port}/devtools/browser`;
	return null;
}

async function resolveEndpoint(options) {
	if (options.wsEndpoint) return options.wsEndpoint;
	if (options.httpEndpoint)
		return endpointFromHttp(
			options.httpEndpoint,
			options.headers,
			options.timeout,
		);

	for (const path of activePortCandidates()) {
		if (!existsSync(path)) continue;
		const [port, browserPath] = readFileSync(path, "utf8")
			.trim()
			.split(/\r?\n/);
		if (port && browserPath) return `ws://127.0.0.1:${port}${browserPath}`;
	}

	const endpoint = await localPortEndpoint(9222, options.headers);
	if (endpoint) return endpoint;
	throw new Error(
		[
			"Could not find Chrome's CDP endpoint.",
			"Enable remote debugging at chrome://inspect/#remote-debugging,",
			"or pass --ws-endpoint / --http-endpoint.",
		].join(" "),
	);
}

class CDP {
	#connection;
	#id = 0;
	#pending = new Map();
	#eventHandlers = new Map();
	#closeHandlers = new Set();
	#defaultTimeout;

	constructor(defaultTimeout) {
		this.#defaultTimeout = defaultTimeout;
	}

	async connect(endpoint, headers, timeout = this.#defaultTimeout) {
		this.#connection = await connectWebSocket(endpoint, headers, timeout);
		this.#connection.onMessage((text) => {
			const message = JSON.parse(text);
			if (message.id && this.#pending.has(message.id)) {
				const pending = this.#pending.get(message.id);
				this.#pending.delete(message.id);
				clearTimeout(pending.timer);
				if (message.error) pending.reject(new Error(message.error.message));
				else pending.resolve(message.result);
			} else if (message.method) {
				for (const handler of this.#eventHandlers.get(message.method) || [])
					handler(message.params || {}, message);
			}
		});
		this.#connection.onClose((error) => {
			for (const pending of this.#pending.values()) {
				clearTimeout(pending.timer);
				pending.reject(error || new Error("Chrome closed the CDP connection"));
			}
			this.#pending.clear();
			for (const handler of this.#closeHandlers) handler(error);
		});
	}

	send(method, params = {}, sessionId, timeout = this.#defaultTimeout) {
		const id = ++this.#id;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				if (!this.#pending.delete(id)) return;
				reject(new Error(`Timed out after ${timeout}ms: ${method}`));
			}, timeout);
			this.#pending.set(id, { resolve, reject, timer });
			const message = { id, method, params };
			if (sessionId) message.sessionId = sessionId;
			this.#connection.sendText(JSON.stringify(message));
		});
	}

	on(method, handler) {
		if (!this.#eventHandlers.has(method))
			this.#eventHandlers.set(method, new Set());
		const handlers = this.#eventHandlers.get(method);
		handlers.add(handler);
		return () => handlers.delete(handler);
	}

	waitForEvent(method, sessionId, timeout = this.#defaultTimeout) {
		let settled = false;
		let timer;
		let off;
		const promise = new Promise((resolve, reject) => {
			off = this.on(method, (params, message) => {
				if (settled || (sessionId && message.sessionId !== sessionId)) return;
				settled = true;
				clearTimeout(timer);
				off();
				resolve(params);
			});
			timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				off();
				reject(new Error(`Timed out after ${timeout}ms waiting for ${method}`));
			}, timeout);
		});
		return {
			promise,
			cancel() {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				off();
			},
		};
	}

	onClose(handler) {
		this.#closeHandlers.add(handler);
	}
	close() {
		this.#connection?.close();
	}
}

async function pages(cdp) {
	const { targetInfos } = await cdp.send("Target.getTargets");
	return targetInfos.filter(
		(target) => target.type === "page" && !target.url.startsWith("chrome://"),
	);
}

function uniquePrefixLength(ids) {
	for (
		let length = MIN_PREFIX;
		length <= Math.max(MIN_PREFIX, ...ids.map((id) => id.length));
		length++
	) {
		if (
			new Set(ids.map((id) => id.slice(0, length).toUpperCase())).size ===
			ids.length
		)
			return length;
	}
	return Math.max(MIN_PREFIX, ...ids.map((id) => id.length));
}

function formatPages(items) {
	const length = uniquePrefixLength(items.map((item) => item.targetId));
	return items
		.map(
			(item) =>
				`${item.targetId.slice(0, length).padEnd(length)}  ${item.title.slice(0, 54).padEnd(54)}  ${item.url}`,
		)
		.join("\n");
}

function resolveTarget(prefix, items) {
	if (!prefix) throw new Error("Target ID required. Run `cdp list` first.");
	const matches = items.filter((item) =>
		item.targetId.toUpperCase().startsWith(prefix.toUpperCase()),
	);
	if (!matches.length)
		throw new Error(
			`No page matches target prefix "${prefix}". Run \`cdp list\` again.`,
		);
	if (matches.length > 1)
		throw new Error(
			`Target prefix "${prefix}" is ambiguous; use more characters.`,
		);
	return matches[0];
}

function axVisible(node) {
	const role = node.role?.value || "";
	const name = node.name?.value ?? "";
	const value = node.value?.value;
	return (
		role !== "none" &&
		role !== "generic" &&
		role !== "InlineTextBox" &&
		(name !== "" || (value !== "" && value != null))
	);
}

function formatSnapshot(nodes) {
	const byId = new Map(nodes.map((node) => [node.nodeId, node]));
	const childrenByParent = new Map();
	for (const node of nodes) {
		if (!node.parentId) continue;
		if (!childrenByParent.has(node.parentId))
			childrenByParent.set(node.parentId, []);
		childrenByParent.get(node.parentId).push(node);
	}
	const output = [];
	const visited = new Set();
	const visit = (node, depth) => {
		if (!node || visited.has(node.nodeId)) return;
		visited.add(node.nodeId);
		const visible = axVisible(node);
		if (visible) {
			const role = node.role?.value || "unknown";
			const ref = node.backendDOMNodeId ? ` ref=${node.backendDOMNodeId}` : "";
			const name = node.name?.value
				? ` ${JSON.stringify(node.name.value)}`
				: "";
			const value = node.value?.value;
			output.push(
				`${"  ".repeat(Math.min(depth, 10))}[${role}${ref}]${name}${value == null || value === "" ? "" : ` value=${JSON.stringify(value)}`}`,
			);
		}
		const childIds = [...(node.childIds || [])];
		for (const child of childrenByParent.get(node.nodeId) || []) {
			if (!childIds.includes(child.nodeId)) childIds.push(child.nodeId);
		}
		const childDepth = visible ? depth + 1 : depth;
		for (const childId of childIds) visit(byId.get(childId), childDepth);
	};
	for (const node of nodes.filter(
		(node) => !node.parentId || !byId.has(node.parentId),
	))
		visit(node, 0);
	for (const node of nodes) visit(node, 0);
	return output.join("\n");
}

async function evaluate(cdp, sid, expression, timeout) {
	const result = await cdp.send(
		"Runtime.evaluate",
		{
			expression,
			returnByValue: true,
			awaitPromise: true,
			userGesture: true,
		},
		sid,
		timeout,
	);
	if (result.exceptionDetails) {
		throw new Error(
			result.exceptionDetails.exception?.description ||
				result.exceptionDetails.text ||
				"JavaScript evaluation failed",
		);
	}
	const value = result.result.value;
	return typeof value === "object"
		? JSON.stringify(value, null, 2)
		: String(value ?? "");
}

async function objectForRef(cdp, sid, ref) {
	const backendNodeId = Number(String(ref).replace(/^ref:/, ""));
	if (!Number.isInteger(backendNodeId))
		throw new Error("Expected an accessibility ref such as ref:123");
	const { object } = await cdp.send("DOM.resolveNode", { backendNodeId }, sid);
	if (!object?.objectId)
		throw new Error(`Could not resolve ref:${backendNodeId}`);
	return object.objectId;
}

async function callOnRef(cdp, sid, ref, functionDeclaration, args = []) {
	const objectId = await objectForRef(cdp, sid, ref);
	const result = await cdp.send(
		"Runtime.callFunctionOn",
		{
			objectId,
			functionDeclaration,
			arguments: args.map((value) => ({ value })),
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		},
		sid,
	);
	if (result.exceptionDetails)
		throw new Error(
			result.exceptionDetails.exception?.description ||
				"Element interaction failed",
		);
	return result.result.value;
}

function parseSelectorOrRef(value) {
	if (!value) throw new Error("A selector or ref is required");
	return /^ref:\d+$/.test(value) ? { ref: value } : { selector: value };
}

async function backendNodeForTarget(cdp, sid, target) {
	const parsed = parseSelectorOrRef(target);
	if (parsed.ref) return Number(parsed.ref.slice(4));
	const result = await cdp.send(
		"Runtime.evaluate",
		{
			expression: `document.querySelector(${JSON.stringify(parsed.selector)})`,
			returnByValue: false,
		},
		sid,
	);
	if (result.exceptionDetails) {
		throw new Error(
			`Invalid CSS selector: ${parsed.selector}. Only standard CSS selectors are supported (not Playwright text= or :has-text()); use a ref from snapshot instead.`,
		);
	}
	if (!result.result?.objectId || result.result.subtype === "null") {
		throw new Error(`Element not found: ${parsed.selector}`);
	}
	try {
		const { node } = await cdp.send(
			"DOM.describeNode",
			{ objectId: result.result.objectId },
			sid,
		);
		return node.backendNodeId;
	} finally {
		await cdp
			.send("Runtime.releaseObject", { objectId: result.result.objectId }, sid)
			.catch(() => {});
	}
}

async function clickElement(cdp, sid, target) {
	const backendNodeId = await backendNodeForTarget(cdp, sid, target);
	let model;
	try {
		await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, sid);
		({ model } = await cdp.send("DOM.getBoxModel", { backendNodeId }, sid));
	} catch {
		await callOnRef(
			cdp,
			sid,
			`ref:${backendNodeId}`,
			`function () { this.click(); }`,
		);
		return "element through DOM fallback";
	}
	const quad = model.border || model.content;
	const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
	const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
	const event = { x, y, button: "left", clickCount: 1 };
	await cdp.send(
		"Input.dispatchMouseEvent",
		{ ...event, type: "mouseMoved" },
		sid,
	);
	await cdp.send(
		"Input.dispatchMouseEvent",
		{ ...event, type: "mousePressed" },
		sid,
	);
	await cdp.send(
		"Input.dispatchMouseEvent",
		{ ...event, type: "mouseReleased" },
		sid,
	);
	return `element at (${Math.round(x)}, ${Math.round(y)})`;
}

const SET_VALUE = `function (value) {
  this.scrollIntoView({block:'center'}); this.focus();
  const prototype = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(this, value); else this.value = value;
  this.dispatchEvent(new Event('input', {bubbles:true}));
  this.dispatchEvent(new Event('change', {bubbles:true}));
  return this.value;
}`;

async function fillElement(cdp, sid, target, value) {
	const parsed = parseSelectorOrRef(target);
	if (parsed.ref) return callOnRef(cdp, sid, parsed.ref, SET_VALUE, [value]);
	return evaluate(
		cdp,
		sid,
		`(${SET_VALUE}).call(document.querySelector(${JSON.stringify(parsed.selector)}) ?? (() => { throw new Error('Element not found') })(), ${JSON.stringify(value)})`,
	);
}

async function waitForDocument(cdp, sid, timeout) {
	const deadline = Date.now() + timeout;
	let lastError;
	while (Date.now() < deadline) {
		try {
			if ((await evaluate(cdp, sid, "document.readyState")) === "complete")
				return;
		} catch (error) {
			lastError = error;
		}
		await sleep(100);
	}
	throw new Error(
		`Navigation did not finish within ${timeout}ms${lastError ? `: ${lastError.message}` : ""}`,
	);
}

async function waitFor(cdp, sid, kind, expected, timeout) {
	if (!["text", "selector"].includes(kind))
		throw new Error("wait-for kind must be `text` or `selector`");
	const condition =
		kind === "text"
			? `document.body?.innerText.includes(${JSON.stringify(expected)})`
			: `document.querySelector(${JSON.stringify(expected)})`;
	const expression = `new Promise((resolve) => {
    const check = () => { if (${condition}) { observer.disconnect(); clearTimeout(timer); resolve(true); } };
    const observer = new MutationObserver(check);
    const timer = setTimeout(() => { observer.disconnect(); resolve(false); }, ${timeout});
    observer.observe(document.documentElement, {subtree:true, childList:true, attributes:true, characterData:true});
    check();
  })`;
	if ((await evaluate(cdp, sid, expression, timeout + 1_000)) !== "true")
		throw new Error(
			`Timed out after ${timeout}ms waiting for ${kind} ${JSON.stringify(expected)}`,
		);
	return `Found ${kind} ${JSON.stringify(expected)}`;
}

const NAMED_KEYS = {
	Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
	Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
	Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
	Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
	Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
	Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
	Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
	End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
	PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
	PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
	ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
	ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
	ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
	ArrowRight: {
		key: "ArrowRight",
		code: "ArrowRight",
		windowsVirtualKeyCode: 39,
	},
};

const MODIFIERS = {
	alt: 1,
	option: 1,
	control: 2,
	ctrl: 2,
	meta: 4,
	cmd: 4,
	command: 4,
	shift: 8,
};

// Chrome only runs editing shortcuts such as select-all for synthetic key
// events when the matching editor command is passed explicitly.
const EDIT_COMMANDS = {
	a: "selectAll",
	c: "copy",
	x: "cut",
	v: "paste",
	z: "undo",
};

function keyDefinition(combo) {
	if (!combo) throw new Error("press requires a key, such as Enter or Meta+a");
	const parts = combo.length > 1 ? combo.split(/\+(?!$)/) : [combo];
	const name = parts.pop();
	let modifiers = 0;
	for (const part of parts) {
		const bit = MODIFIERS[part.toLowerCase()];
		if (!bit) throw new Error(`Unknown modifier "${part}" in ${combo}`);
		modifiers |= bit;
	}
	let definition = NAMED_KEYS[name];
	if (!definition) {
		if (name.length !== 1)
			throw new Error(
				`Unknown key "${name}". Use a single character or one of: ${Object.keys(NAMED_KEYS).join(", ")}`,
			);
		const upper = name.toUpperCase();
		const key = modifiers & MODIFIERS.shift ? upper : name;
		definition = {
			key,
			text: key,
			code: /[a-z]/i.test(name)
				? `Key${upper}`
				: /\d/.test(name)
					? `Digit${name}`
					: undefined,
			windowsVirtualKeyCode: upper.charCodeAt(0),
		};
	}
	definition = { ...definition, modifiers };
	// Shortcuts with Alt, Control, or Meta must not insert their character.
	if (modifiers & (MODIFIERS.alt | MODIFIERS.control | MODIFIERS.meta)) {
		delete definition.text;
		const command = EDIT_COMMANDS[name.toLowerCase()];
		const primary = modifiers & ~MODIFIERS.shift;
		if (
			command &&
			(primary === MODIFIERS.meta || primary === MODIFIERS.control)
		)
			definition.commands = [
				command === "undo" && modifiers & MODIFIERS.shift ? "redo" : command,
			];
	}
	return definition;
}

function normalizeHttpEndpoint(endpoint) {
	return endpoint.replace(/\/$/, "");
}

function connectionIdentity(options, resolvedEndpoint) {
	if (options.wsEndpoint) return `ws:${options.wsEndpoint}`;
	if (options.httpEndpoint)
		return `http:${normalizeHttpEndpoint(options.httpEndpoint)}`;
	// Share a daemon with an explicit --ws-endpoint for the same browser, so
	// switching styles does not trigger another approval prompt.
	return `ws:${resolvedEndpoint}`;
}

function stateId(identity, headers) {
	return createHash("sha256")
		.update(identity)
		.update("\0")
		.update(JSON.stringify(headers))
		.digest("hex")
		.slice(0, 16);
}

function safeConnectionLabel(options) {
	const endpoint = options.wsEndpoint || options.httpEndpoint;
	if (!endpoint) return "auto-discovered Chrome";
	try {
		const url = new URL(endpoint);
		return `${options.wsEndpoint ? "WebSocket" : "HTTP"} ${url.protocol}//${url.host}`;
	} catch {
		return options.wsEndpoint
			? "explicit WebSocket endpoint"
			: "explicit HTTP endpoint";
	}
}

function stateDirectory() {
	const directory = process.env.CDP_STATE_DIR || tmpdir();
	if (process.env.CDP_STATE_DIR)
		mkdirSync(directory, { recursive: true, mode: 0o700 });
	return directory;
}

function statePath(id) {
	return join(stateDirectory(), `${STATE_PREFIX}${id}.json`);
}
function configPath(id) {
	return join(stateDirectory(), `${STATE_PREFIX}${id}.config.json`);
}
function pendingPath(id) {
	return join(stateDirectory(), `${STATE_PREFIX}${id}.pending.json`);
}

function processAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

function removePending(id) {
	try {
		unlinkSync(pendingPath(id));
	} catch {}
}

// Atomically claims the right to start a daemon. Returns false when another
// live process is already starting one for the same connection.
function claimPending(id) {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			writeFileSync(pendingPath(id), JSON.stringify({ pid: process.pid }), {
				flag: "wx",
				mode: 0o600,
			});
			return true;
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
		}
		const pending = readState(pendingPath(id));
		if (pending && !pending.error && processAlive(pending.pid)) return false;
		removePending(id);
	}
	return false;
}

function isLoopbackEndpoint(endpoint) {
	try {
		const { hostname } = new URL(endpoint);
		return ["127.0.0.1", "localhost", "[::1]"].includes(hostname);
	} catch {
		return false;
	}
}

function readState(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function daemonStates() {
	const pattern = new RegExp(`^${STATE_PREFIX}([a-f0-9]{16})\\.json$`);
	return readdirSync(stateDirectory(), { withFileTypes: true }).flatMap(
		(entry) => {
			const match = entry.isFile() && entry.name.match(pattern);
			if (!match) return [];
			const path = join(stateDirectory(), entry.name);
			const state = readState(path);
			return state ? [{ id: match[1], path, state }] : [];
		},
	);
}

function connectDaemon(state) {
	return new Promise((resolve, reject) => {
		const socket = net.connect({ host: "127.0.0.1", port: state.port });
		socket.once("connect", () => resolve(socket));
		socket.once("error", reject);
	});
}

function daemonRequest(socket, state, command) {
	return new Promise((resolve, reject) => {
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk;
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			const response = JSON.parse(buffer.slice(0, newline));
			socket.end();
			if (response.ok) resolve(response.result);
			else reject(new Error(response.error));
		});
		socket.once("error", reject);
		socket.write(`${JSON.stringify({ token: state.token, ...command })}\n`);
	});
}

async function daemonFor(endpoint, options) {
	const identity = connectionIdentity(options, endpoint);
	const id = stateId(identity, options.headers);
	const path = statePath(id);
	let state = readState(path);
	if (state) {
		try {
			const socket = await connectDaemon(state);
			return { socket, state };
		} catch {
			try {
				unlinkSync(path);
			} catch {}
		}
	}

	// Reuse a daemon that is still waiting for Chrome's approval instead of
	// spawning another one, which would show the user a second prompt.
	if (claimPending(id)) {
		const config = {
			endpoint,
			headers: options.headers,
			timeout: options.timeout,
			id,
			label: safeConnectionLabel(options),
		};
		writeFileSync(configPath(id), JSON.stringify(config), { mode: 0o600 });
		const child = spawn(process.execPath, [SCRIPT, "_daemon", id], {
			detached: true,
			stdio: "ignore",
		});
		child.unref();
	}

	const started = Date.now();
	let noticed = false;
	while (Date.now() - started < APPROVAL_TIMEOUT + 5_000) {
		await sleep(200);
		state = readState(path);
		if (state) {
			try {
				const socket = await connectDaemon(state);
				return { socket, state };
			} catch {}
			continue;
		}
		const current = readState(pendingPath(id));
		if (current?.error) {
			removePending(id);
			throw new Error(`Could not connect to the browser: ${current.error}`);
		}
		if ((!current || !processAlive(current.pid)) && !readState(path)) {
			removePending(id);
			throw new Error("CDP daemon exited before connecting to the browser.");
		}
		if (!noticed && Date.now() - started > APPROVAL_NOTICE_DELAY) {
			noticed = true;
			process.stderr.write(
				"Waiting for the browser to accept the debugging connection. If Chrome shows an Allow debugging prompt, click Allow.\n",
			);
		}
	}
	throw new Error(
		"Timed out waiting for the browser to accept the debugging connection. Grant Chrome debugging access if prompted, then retry.",
	);
}

async function runDaemon(id) {
	const daemonConfigPath = configPath(id);
	const config = JSON.parse(readFileSync(daemonConfigPath, "utf8"));
	try {
		unlinkSync(daemonConfigPath);
	} catch {}
	const path = statePath(config.id);
	const token = randomBytes(24).toString("hex");
	writeFileSync(pendingPath(config.id), JSON.stringify({ pid: process.pid }), {
		mode: 0o600,
	});
	const cdp = new CDP(config.timeout);
	try {
		await cdp.connect(
			config.endpoint,
			config.headers,
			isLoopbackEndpoint(config.endpoint)
				? Math.max(config.timeout, APPROVAL_TIMEOUT)
				: config.timeout,
		);
	} catch (error) {
		writeFileSync(
			pendingPath(config.id),
			JSON.stringify({ pid: process.pid, error: error.message }),
			{ mode: 0o600 },
		);
		process.exit(1);
	}
	const sessions = new Map();
	const consoleMessages = new Map();
	const failedRequests = new Map();
	const activeRequests = new Map();
	let closing = false;
	let idleTimer;
	let activeCommands = 0;

	async function sessionFor(targetId) {
		if (sessions.has(targetId)) return sessions.get(targetId);
		const { sessionId } = await cdp.send("Target.attachToTarget", {
			targetId,
			flatten: true,
		});
		sessions.set(targetId, sessionId);
		consoleMessages.set(sessionId, []);
		failedRequests.set(sessionId, []);
		activeRequests.set(sessionId, new Map());
		await Promise.all([
			cdp.send("Runtime.enable", {}, sessionId),
			cdp.send("Page.enable", {}, sessionId),
			cdp.send("DOM.enable", {}, sessionId),
			cdp.send("Network.enable", {}, sessionId),
			cdp.send("Log.enable", {}, sessionId),
		]);
		return sessionId;
	}

	cdp.on("Runtime.consoleAPICalled", (params, message) => {
		const list = consoleMessages.get(message.sessionId);
		if (!list) return;
		const values = params.args.map(
			(arg) => arg.value ?? arg.description ?? arg.type,
		);
		list.push({
			type: params.type,
			text: values.join(" "),
			timestamp: params.timestamp,
		});
		if (list.length > 200) list.shift();
	});
	cdp.on("Log.entryAdded", (params, message) => {
		const list = consoleMessages.get(message.sessionId);
		if (!list) return;
		list.push({
			type: params.entry.level,
			text: params.entry.text,
			source: params.entry.source,
		});
		if (list.length > 200) list.shift();
	});
	cdp.on("Network.requestWillBeSent", (params, message) => {
		activeRequests.get(message.sessionId)?.set(params.requestId, {
			url: params.request.url,
			method: params.request.method,
		});
	});
	cdp.on("Network.loadingFinished", (params, message) => {
		activeRequests.get(message.sessionId)?.delete(params.requestId);
	});
	cdp.on("Network.loadingFailed", (params, message) => {
		const list = failedRequests.get(message.sessionId);
		if (!list) return;
		const request =
			activeRequests.get(message.sessionId)?.get(params.requestId) || {};
		activeRequests.get(message.sessionId)?.delete(params.requestId);
		list.push({
			...request,
			errorText: params.errorText,
			canceled: params.canceled,
			type: params.type,
		});
		if (list.length > 200) list.shift();
	});
	cdp.on("Target.detachedFromTarget", ({ sessionId, targetId }) => {
		sessions.delete(targetId);
		consoleMessages.delete(sessionId);
		failedRequests.delete(sessionId);
		activeRequests.delete(sessionId);
	});

	const shutdown = () => {
		if (closing) return;
		closing = true;
		clearTimeout(idleTimer);
		server.close();
		try {
			unlinkSync(path);
		} catch {}
		cdp.close();
	};
	const resetIdle = () => {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
	};
	const beginCommand = () => {
		activeCommands++;
		clearTimeout(idleTimer);
	};
	const finishCommand = () => {
		activeCommands--;
		if (activeCommands === 0) resetIdle();
	};
	cdp.onClose(shutdown);
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	async function execute(command, args, timeout = config.timeout) {
		if (command === "list") return formatPages(await pages(cdp));
		if (command === "stop") return { stop: true, output: "" };
		if (command === "open" || command === "new") {
			const url = args[0] || "about:blank";
			const { targetId } = await cdp.send("Target.createTarget", { url });
			return `Opened ${targetId}\n${url}`;
		}
		const target = resolveTarget(args[0], await pages(cdp));
		const sid = await sessionFor(target.targetId);
		const rest = args.slice(1);

		if (command === "snapshot" || command === "snap") {
			const { nodes } = await cdp.send("Accessibility.getFullAXTree", {}, sid);
			return formatSnapshot(nodes);
		}
		if (command === "evaluate" || command === "eval")
			return evaluate(cdp, sid, rest.join(" "), timeout);
		if (command === "html")
			return evaluate(
				cdp,
				sid,
				rest[0]
					? `document.querySelector(${JSON.stringify(rest[0])})?.outerHTML ?? 'Element not found'`
					: "document.documentElement.outerHTML",
			);
		if (command === "navigate" || command === "nav") {
			if (!rest[0]) throw new Error("navigate requires a URL");
			const navigationTimeout = rest[1]
				? positiveInteger(rest[1], "navigation timeout")
				: timeout;
			const loaded = cdp.waitForEvent(
				"Page.loadEventFired",
				sid,
				navigationTimeout,
			);
			let result;
			try {
				result = await cdp.send(
					"Page.navigate",
					{ url: rest[0] },
					sid,
					navigationTimeout,
				);
			} catch (error) {
				loaded.cancel();
				throw error;
			}
			if (result.errorText) {
				loaded.cancel();
				throw new Error(result.errorText);
			}
			if (result.loaderId) await loaded.promise;
			else loaded.cancel();
			await waitForDocument(cdp, sid, navigationTimeout);
			return `Navigated to ${rest[0]}`;
		}
		if (command === "click") {
			const result = await clickElement(cdp, sid, rest[0]);
			return `Clicked ${result}`;
		}
		if (command === "fill") {
			const value = await fillElement(
				cdp,
				sid,
				rest[0],
				rest.slice(1).join(" "),
			);
			return `Filled element with ${JSON.stringify(value)}`;
		}
		if (command === "type") {
			const text = rest.join(" ");
			const focusedTag = await evaluate(
				cdp,
				sid,
				`(() => { const el = document.activeElement; return !el || el === document.body || el === document.documentElement ? "" : el.tagName; })()`,
			);
			if (!focusedTag) {
				throw new Error(
					"Nothing is focused, so typed text would be discarded. Click or focus an element first, or use fill.",
				);
			}
			await cdp.send("Input.insertText", { text }, sid);
			return `Typed ${text.length} characters into <${focusedTag.toLowerCase()}>`;
		}
		if (command === "press") {
			const key = keyDefinition(rest[0]);
			await cdp.send(
				"Input.dispatchKeyEvent",
				{ type: "keyDown", ...key },
				sid,
			);
			await cdp.send(
				"Input.dispatchKeyEvent",
				{ type: "keyUp", ...key, text: undefined, commands: undefined },
				sid,
			);
			return `Pressed ${rest[0]}`;
		}
		if (command === "wait-for") {
			const waitTimeout = rest[2]
				? positiveInteger(rest[2], "wait timeout")
				: timeout;
			return waitFor(cdp, sid, rest[0], rest[1], waitTimeout);
		}
		if (command === "live-view") {
			const expiresInMs = rest[0]
				? positiveIntegerAtMost(rest[0], "Live View expiry", 3_600_000)
				: 600_000;
			const { devtoolsFrontendUrl } = await cdp.send(
				"Cloudflare.getLiveView",
				{ mode: "tab", expiresInMs },
				sid,
			);
			return devtoolsFrontendUrl;
		}
		if (command === "handoff-state") {
			return JSON.stringify(
				await cdp.send("Cloudflare.getHandoffState", {}, sid),
				null,
				2,
			);
		}
		if (command === "handoff") {
			if (!rest[0]) throw new Error("handoff requires instructions");
			const handoffTimeout = rest[1]
				? positiveIntegerAtMost(rest[1], "handoff timeout", 1_800_000)
				: 600_000;
			const completed = cdp.waitForEvent(
				"Cloudflare.handoffComplete",
				sid,
				handoffTimeout + 1_000,
			);
			let handoff;
			try {
				handoff = await cdp.send(
					"Cloudflare.handoff",
					{ instructions: rest[0], timeout: handoffTimeout },
					sid,
				);
			} catch (error) {
				completed.cancel();
				throw error;
			}
			return JSON.stringify(
				{ handoffId: handoff.handoffId, ...(await completed.promise) },
				null,
				2,
			);
		}
		if (command === "screenshot" || command === "shot") {
			const screenshot = parseScreenshotArgs(rest);
			const params = {
				format: screenshot.format,
				captureBeyondViewport: screenshot.fullPage,
			};
			if (screenshot.format !== "png") params.quality = screenshot.quality;
			if (screenshot.fullPage) {
				const { contentSize } = await cdp.send(
					"Page.getLayoutMetrics",
					{},
					sid,
				);
				params.clip = {
					x: 0,
					y: 0,
					width: contentSize.width,
					height: contentSize.height,
					scale: 1,
				};
			}
			const { data } = await cdp.send(
				"Page.captureScreenshot",
				params,
				sid,
				Math.max(timeout, 30_000),
			);
			const bytes = Buffer.from(data, "base64");
			writeFileSync(screenshot.path, bytes);
			return `${screenshot.path}\nSaved ${(bytes.length / 1024).toFixed(1)} KiB ${screenshot.format.toUpperCase()} screenshot.`;
		}
		if (command === "console")
			return JSON.stringify(consoleMessages.get(sid) || [], null, 2);
		if (command === "failures")
			return JSON.stringify(failedRequests.get(sid) || [], null, 2);
		if (command === "raw") {
			const params = rest[1] ? JSON.parse(rest.slice(1).join(" ")) : {};
			return JSON.stringify(
				await cdp.send(rest[0], params, sid, timeout),
				null,
				2,
			);
		}
		throw new Error(`Unknown command: ${command}`);
	}

	const server = net.createServer((socket) => {
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk;
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			let request;
			try {
				request = JSON.parse(buffer.slice(0, newline));
			} catch {
				socket.end(
					`${JSON.stringify({ ok: false, error: "Invalid request" })}\n`,
				);
				return;
			}
			if (request.token !== token) {
				socket.end(`${JSON.stringify({ ok: false, error: "Unauthorized" })}\n`);
				return;
			}
			beginCommand();
			execute(request.command, request.args || [], request.timeout)
				.then((result) => {
					const stop = typeof result === "object" && result.stop;
					const output = stop ? result.output : result;
					if (!stop) finishCommand();
					socket.end(
						`${JSON.stringify({ ok: true, result: output ?? "" })}\n`,
						stop ? shutdown : undefined,
					);
				})
				.catch((error) => {
					finishCommand();
					socket.end(
						`${JSON.stringify({ ok: false, error: error.message })}\n`,
					);
				});
		});
	});
	server.listen(0, "127.0.0.1", () => {
		const state = {
			id: config.id,
			label: config.label,
			port: server.address().port,
			token,
			pid: process.pid,
		};
		writeFileSync(path, JSON.stringify(state), { mode: 0o600 });
		removePending(config.id);
		resetIdle();
	});
}

function parseStopArgs(args, options) {
	let all = false;
	let id;
	for (let index = 0; index < args.length; index++) {
		if (args[index] === "--all") all = true;
		else if (args[index] === "--id") {
			id = args[++index];
			if (!id) throw new Error("stop --id requires a daemon id");
		} else throw new Error(`Unknown stop option: ${args[index]}`);
	}
	if (id && !/^[a-f0-9]{16}$/i.test(id))
		throw new Error("--id must be a 16-character daemon id");
	if (all && id) throw new Error("Choose either stop --id or stop --all");
	// --all and --id win over an endpoint, which may come from CDP_* env vars.
	const explicitEndpoint =
		!all && !id && Boolean(options.wsEndpoint || options.httpEndpoint);
	if (explicitEndpoint && options.wsEndpoint && options.httpEndpoint) {
		throw new Error("Choose either --ws-endpoint or --http-endpoint, not both");
	}
	return { all, id: id?.toLowerCase(), explicitEndpoint };
}

async function stopState(entry) {
	try {
		const socket = await connectDaemon(entry.state);
		await daemonRequest(socket, entry.state, { command: "stop", args: [] });
		return `Stopped ${entry.id} (${entry.state.label || "unknown endpoint"}).`;
	} catch {
		try {
			unlinkSync(entry.path);
		} catch {}
		return `Removed stale daemon state ${entry.id} (${entry.state.label || "unknown endpoint"}).`;
	}
}

async function stopDaemons(args, options) {
	const selector = parseStopArgs(args, options);
	const states = daemonStates();
	let selected;

	if (selector.explicitEndpoint) {
		const identity = connectionIdentity(options);
		const id = stateId(identity, options.headers);
		selected = states.filter((entry) => entry.id === id);
	} else if (selector.id) {
		selected = states.filter((entry) => entry.id === selector.id);
	} else if (selector.all) {
		selected = states;
	} else if (states.length === 1) {
		selected = states;
	} else if (states.length === 0) {
		return "No CDP daemons are running.";
	} else {
		const choices = states
			.map(
				(entry) => `  ${entry.id}  ${entry.state.label || "unknown endpoint"}`,
			)
			.join("\n");
		throw new Error(
			`Multiple CDP daemons are running. Use stop --id <id> or stop --all:\n${choices}`,
		);
	}

	if (!selected.length) return "No matching CDP daemon is running.";
	return (await Promise.all(selected.map(stopState))).join("\n");
}

function parseScreenshotArgs(args) {
	let path;
	let format = "jpeg";
	let quality = 75;
	let fullPage = false;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--format") format = args[++i];
		else if (args[i] === "--quality")
			quality = positiveInteger(args[++i], "--quality");
		else if (args[i] === "--full-page") fullPage = true;
		else if (!path) path = resolve(args[i]);
		else throw new Error(`Unexpected screenshot argument: ${args[i]}`);
	}
	if (!["jpeg", "webp", "png"].includes(format))
		throw new Error("--format must be jpeg, webp, or png");
	if (quality > 100) throw new Error("--quality must be at most 100");
	path ||= resolve(
		tmpdir(),
		`screenshot.${format === "jpeg" ? "jpg" : format}`,
	);
	mkdirSync(dirname(path), { recursive: true });
	return { path, format, quality, fullPage };
}

const USAGE = `cdp ${VERSION} — direct Chrome DevTools Protocol CLI (Node.js 22+, no dependencies)

Usage: node <skill-directory>/scripts/cdp.mjs [connection options] <command> [arguments]

Connection options:
  --ws-endpoint <ws://...>       Browser CDP WebSocket endpoint
  --http-endpoint <http://...>   Discover endpoint through /json/version
  --headers <json>               Headers for HTTP and WebSocket connections
  --timeout <ms>                 Command timeout (default: 15000)

The same values can be set with CDP_WS_ENDPOINT, CDP_HTTP_ENDPOINT, and
CDP_HEADERS. With no endpoint, the CLI discovers a local Chrome instance.

Commands:
  list
  open [url]
  snapshot <target>
  screenshot <target> [file] [--format jpeg|webp|png] [--quality 75] [--full-page]
  navigate <target> <url> [timeout-ms]
  evaluate <target> <expression>
  html <target> [selector]
  click <target> <selector|ref:123>
  fill <target> <selector|ref:123> <value>
  type <target> <text>
  press <target> <key>          e.g. Enter, Space, Escape, Meta+a, Shift+Tab
  wait-for <target> <text|selector> <value> [timeout-ms]
  live-view <target> [expires-ms]
  handoff <target> <instructions> [timeout-ms]
  handoff-state <target>
  console <target>
  failures <target>
  raw <target> <CDP.method> [json-params]
  stop [--id <daemon-id> | --all]

With an explicit --ws-endpoint or --http-endpoint, stop targets only that daemon,
unless --id or --all is given.
With no selector, it stops the only daemon and refuses if multiple are running.

Targets are unique ID prefixes shown by list. snapshot prints stable ref values
for elements; pass one as ref:123 to click or fill. A background daemon keeps the
Chrome connection alive for 20 minutes so browser approval is only needed once.`;

async function main() {
	const { options, args } = parseOptions(process.argv.slice(2));
	if (args[0] === "_daemon") return runDaemon(args[1]);
	if (options.version) {
		console.log(VERSION);
		return;
	}
	if (options.help || !args.length) {
		console.log(USAGE);
		return;
	}

	const [command, ...commandArgs] = args;
	const supported = new Set([
		"list",
		"open",
		"new",
		"snapshot",
		"snap",
		"screenshot",
		"shot",
		"navigate",
		"nav",
		"evaluate",
		"eval",
		"html",
		"click",
		"fill",
		"type",
		"press",
		"wait-for",
		"live-view",
		"handoff",
		"handoff-state",
		"console",
		"failures",
		"raw",
		"stop",
	]);
	if (!supported.has(command))
		throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
	if (command === "stop") {
		console.log(await stopDaemons(commandArgs, options));
		return;
	}
	const endpoint = await resolveEndpoint(options);
	const { socket, state } = await daemonFor(endpoint, options);
	const result = await daemonRequest(socket, state, {
		command,
		args: commandArgs,
		timeout: options.timeout,
	});
	if (result) console.log(result);
}

function isMainModule() {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		// Compare real paths: Node dereferences symlinks for import.meta.url but
		// not for process.argv[1], so a symlinked install (e.g. a skills dir)
		// would otherwise fail this guard and never run main().
		return realpathSync(entry) === realpathSync(SCRIPT);
	} catch {
		return false;
	}
}

if (isMainModule()) {
	main().catch((error) => {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	});
}

export {
	connectionIdentity,
	formatPages,
	formatSnapshot,
	keyDefinition,
	localPortEndpoint,
	parseOptions,
	parseScreenshotArgs,
	resolveTarget,
	uniquePrefixLength,
};
