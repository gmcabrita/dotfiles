// Shared state and Rex helpers for the subagent extension (index.ts) and CLI (cli.ts).
//
// Each run lives in ~/.pi/agent/subagents/<handle>/ with metadata.json, the child
// Pi session.jsonl, and an inbox/ of queued messages. The child Pi process runs in
// a Rex terminal block; Rex is the only process supervisor.

import { execFile, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	rmdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RunState = "starting" | "busy" | "idle" | "exited" | "error";

/** Rex IDs of the terminal that hosts the child Pi process. */
export interface RexTerminal {
	session: string;
	block: string;
}

export interface RunMetadata {
	version: 2;
	handle: string;
	name?: string;
	parentSessionId?: string;
	parentSessionFile?: string;
	childSessionId?: string;
	/** Absent while the run is launching or suspended. */
	terminal?: RexTerminal;
	runDir: string;
	sessionFile: string;
	cwd: string;
	provider: string;
	model: string;
	thinking: string;
	/** Extra pi CLI flags (tools, isolation, trust) reused when the run is relaunched. */
	launchArgs?: string[];
	/** Set by the parent when it stops the child on quit or session switch; the child is relaunched on resume. */
	suspended?: boolean;
	state: RunState;
	hasStarted: boolean;
	createdAt: string;
	updatedAt: string;
	error?: string;
}

export interface InboxMessage {
	message: string;
	delivery: "auto" | "followUp";
}

interface SessionEntry {
	type: string;
	id: string;
	parentId: string | null;
	message?: unknown;
}

interface AssistantMessage {
	role: "assistant";
	content?: unknown;
	stopReason?: string;
	errorMessage?: string;
}

interface AssistantEntry extends SessionEntry {
	type: "message";
	message: AssistantMessage;
}

export function getAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function getRunsDir(): string {
	return join(getAgentDir(), "subagents");
}

export function metadataPath(runDir: string): string {
	return join(runDir, "metadata.json");
}

export function inboxDir(runDir: string): string {
	return join(runDir, "inbox");
}

export function isValidRunName(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 64 &&
		value.trim() === value &&
		!/[\u0000-\u001f\u007f]/.test(value)
	);
}

export function runDisplayName(metadata: RunMetadata): string {
	return metadata.name ? `${metadata.name} (${metadata.handle})` : metadata.handle;
}

/** Label shown in the Rex sidebar for the run's session. */
export function rexSessionLabel(metadata: RunMetadata): string {
	return `subagent ${metadata.name ?? metadata.handle}`;
}

function isRexTerminal(value: unknown): value is RexTerminal {
	if (typeof value !== "object" || value === null) return false;
	const terminal = value as Record<string, unknown>;
	return typeof terminal.session === "string" && typeof terminal.block === "string";
}

export function readMetadata(runDir: string): RunMetadata | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(metadataPath(runDir), "utf8"));
		if (typeof value !== "object" || value === null) return undefined;
		const metadata = value as Partial<RunMetadata>;
		if (
			metadata.version !== 2 ||
			typeof metadata.handle !== "string" ||
			(metadata.name !== undefined && !isValidRunName(metadata.name)) ||
			(metadata.terminal !== undefined && !isRexTerminal(metadata.terminal)) ||
			typeof metadata.sessionFile !== "string" ||
			typeof metadata.runDir !== "string"
		) {
			return undefined;
		}
		return metadata as RunMetadata;
	} catch {
		return undefined;
	}
}

export function writeMetadata(metadata: RunMetadata): void {
	mkdirSync(dirname(metadataPath(metadata.runDir)), { recursive: true, mode: 0o700 });
	const target = metadataPath(metadata.runDir);
	const temporary = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	renameSync(temporary, target);
}

const METADATA_LOCK_WAIT_MS = 2000;
const METADATA_LOCK_STALE_MS = 10_000;
const METADATA_LOCK_RETRY_MS = 10;

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Serialize read-modify-write of metadata.json across the parent, the child, and
 * the CLI. mkdir is atomic on every platform, so a lock directory is the mutex. A
 * lock older than METADATA_LOCK_STALE_MS belongs to a dead process and is removed.
 */
function withMetadataLock<T>(runDir: string, fn: () => T): T {
	const lockDir = join(runDir, "metadata.lock");
	const deadline = Date.now() + METADATA_LOCK_WAIT_MS;
	for (;;) {
		try {
			mkdirSync(lockDir);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			try {
				if (Date.now() - statSync(lockDir).mtimeMs > METADATA_LOCK_STALE_MS) rmdirSync(lockDir);
			} catch {
				// Another process removed or replaced the lock. Retry.
			}
			if (Date.now() > deadline) throw new Error(`Timed out waiting for ${lockDir}`);
			sleepSync(METADATA_LOCK_RETRY_MS);
		}
	}
	try {
		return fn();
	} finally {
		rmdirSync(lockDir);
	}
}

export function updateMetadata(runDir: string, patch: Partial<RunMetadata>): RunMetadata | undefined {
	return withMetadataLock(runDir, () => {
		const current = readMetadata(runDir);
		if (!current) return undefined;
		const next: RunMetadata = {
			...current,
			...patch,
			version: 2,
			handle: current.handle,
			runDir: current.runDir,
			updatedAt: new Date().toISOString(),
		};
		writeMetadata(next);
		return next;
	});
}

export async function waitForRunShutdown(runDir: string, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const metadata = readMetadata(runDir);
		if (!metadata || metadata.state === "exited") return;
		await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50));
	}
}

export function removeRunDir(runDir: string): void {
	rmSync(runDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

// --- Rex ---------------------------------------------------------------------

interface RexResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

function rex(args: string[]): RexResult {
	const result = spawnSync("rex", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (result.error) {
		return { status: null, stdout: "", stderr: result.error.message };
	}
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function rexAsync(args: string[]): Promise<RexResult> {
	try {
		const { stdout, stderr } = await execFileAsync("rex", args, { encoding: "utf8" });
		return { status: 0, stdout, stderr };
	} catch (error) {
		const failure = error as { code?: unknown; stdout?: string; stderr?: string; message: string };
		return {
			status: typeof failure.code === "number" ? failure.code : null,
			stdout: failure.stdout ?? "",
			stderr: failure.stderr ?? failure.message,
		};
	}
}

function rexError(result: RexResult, fallback: string): string {
	return result.stderr.trim() || result.stdout.trim() || fallback;
}

/** rex exit status when a session, window, or block target does not exist. */
const REX_EXIT_TARGET_NOT_FOUND = 3;

/**
 * Liveness of the child Pi process. "unknown" means Rex could not answer (server
 * down, timeout, bad output); callers must not destroy anything on "unknown".
 */
export type ChildLiveness = "running" | "exited" | "unknown";

function processReportArgs(terminal: RexTerminal): string[] {
	return [
		"api",
		"call",
		"-s",
		terminal.session,
		"com.superlogical.terminal.process",
		JSON.stringify({ block_id: terminal.block, args: {} }),
	];
}

/**
 * The session and block outlive the process because the terminal is created with
 * --keep-open, so the terminal's process report is the source of truth: `child` is
 * present while the process runs. A missing session or block means it is gone.
 */
function livenessFromProcessReport(result: RexResult): ChildLiveness {
	if (result.status === REX_EXIT_TARGET_NOT_FOUND) return "exited";
	if (result.status !== 0) return "unknown";
	try {
		const report = JSON.parse(result.stdout) as { child?: unknown };
		return report.child !== null && report.child !== undefined ? "running" : "exited";
	} catch {
		return "unknown";
	}
}

export function childLiveness(terminal: RexTerminal | undefined): ChildLiveness {
	if (!terminal) return "exited";
	return livenessFromProcessReport(rex(processReportArgs(terminal)));
}

export async function childLivenessAsync(terminal: RexTerminal | undefined): Promise<ChildLiveness> {
	if (!terminal) return "exited";
	return livenessFromProcessReport(await rexAsync(processReportArgs(terminal)));
}

/** Kill the run's Rex session. Returns false when Rex reports a failure other than "already gone". */
export function killRexSession(terminal: RexTerminal | undefined): boolean {
	if (!terminal) return true;
	const result = rex(["kill", terminal.session]);
	return result.status === 0 || result.status === REX_EXIT_TARGET_NOT_FOUND;
}

export function renameRexSession(terminal: RexTerminal | undefined, label: string): void {
	if (!terminal) return;
	rex(["session", "rename", terminal.session, label]);
}

/**
 * Start the child pi process for a run in a new Rex session and return its IDs.
 * `initialArgs` are only passed on first spawn. The caller stores the terminal in
 * metadata; the child does not need it.
 */
export function launchRun(metadata: RunMetadata, initialArgs: string[] = []): RexTerminal {
	const result = rex([
		"new",
		rexSessionLabel(metadata),
		"--cwd",
		metadata.cwd,
		"--keep-open",
		"--json",
		"--",
		"env",
		`PI_SUBAGENT_RUN_DIR=${metadata.runDir}`,
		"pi",
		"--session",
		metadata.sessionFile,
		"--provider",
		metadata.provider,
		"--model",
		metadata.model,
		"--thinking",
		metadata.thinking,
		...(metadata.launchArgs ?? []),
		...initialArgs,
	]);
	if (result.status !== 0) throw new Error(rexError(result, "Failed to create Rex session"));

	let created: { session_id?: unknown; initial_windows?: unknown };
	try {
		created = JSON.parse(result.stdout);
	} catch {
		throw new Error(`Unexpected output from rex new: ${result.stdout.trim()}`);
	}
	const windows = Array.isArray(created.initial_windows) ? created.initial_windows : [];
	const firstWindow = windows[0] as { block_ids?: unknown } | undefined;
	const blockIds = Array.isArray(firstWindow?.block_ids) ? firstWindow.block_ids : [];
	const block = blockIds[0];
	if (typeof created.session_id !== "string" || typeof block !== "string") {
		throw new Error(`rex new did not return a session and block ID: ${result.stdout.trim()}`);
	}
	return { session: created.session_id, block };
}

/** Pure: combine the recorded state with the observed liveness of the child process. */
export function resolveRunState(metadata: RunMetadata, liveness: ChildLiveness): RunState {
	if (metadata.state !== "starting" && metadata.state !== "busy" && metadata.state !== "idle") {
		return metadata.state;
	}
	// A run without a terminal is between spawn and launch, or suspended. Both are
	// not "exited": spawn resolves within milliseconds and suspended runs resume.
	if (!metadata.terminal) return metadata.suspended ? metadata.state : "starting";
	return liveness === "exited" ? "exited" : metadata.state;
}

export function effectiveRunState(metadata: RunMetadata): RunState {
	return resolveRunState(metadata, metadata.terminal ? childLiveness(metadata.terminal) : "exited");
}

export async function effectiveRunStateAsync(metadata: RunMetadata): Promise<RunState> {
	return resolveRunState(metadata, metadata.terminal ? await childLivenessAsync(metadata.terminal) : "exited");
}

// --- Project trust -------------------------------------------------------------

/**
 * True when Pi's trust store (~/.pi/agent/trust.json) holds a decision for `cwd` or
 * one of its ancestors. Without one, a child Pi started in `cwd` shows the trust
 * prompt in its TUI and waits there. Mirrors findNearestTrustEntry in pi's
 * trust-manager, including the path canonicalization.
 */
export function hasStoredTrustDecision(cwd: string): boolean {
	let data: Record<string, unknown>;
	try {
		const value: unknown = JSON.parse(readFileSync(join(getAgentDir(), "trust.json"), "utf8"));
		if (typeof value !== "object" || value === null) return false;
		data = value as Record<string, unknown>;
	} catch {
		return false;
	}
	let current = resolve(cwd);
	try {
		current = realpathSync(current);
	} catch {
		// Keep the resolved path when it cannot be canonicalized.
	}
	for (;;) {
		if (data[current] === true || data[current] === false) return true;
		const parent = dirname(current);
		if (parent === current) return false;
		current = parent;
	}
}

export function listRuns(parentSessionId?: string): RunMetadata[] {
	const root = getRunsDir();
	if (!existsSync(root)) return [];
	const runs: RunMetadata[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const metadata = readMetadata(join(root, entry.name));
		if (!metadata) continue;
		if (parentSessionId && metadata.parentSessionId !== parentSessionId) continue;
		runs.push(metadata);
	}
	return runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function isSessionEntry(value: unknown): value is SessionEntry {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.type === "string" &&
		typeof entry.id === "string" &&
		(entry.parentId === null || typeof entry.parentId === "string")
	);
}

function activeBranch(entries: SessionEntry[]): SessionEntry[] {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const branch: SessionEntry[] = [];
	const seen = new Set<string>();
	let current = entries.at(-1);
	while (current && !seen.has(current.id)) {
		branch.push(current);
		seen.add(current.id);
		current = current.parentId === null ? undefined : byId.get(current.parentId);
	}
	return branch.reverse();
}

function isAssistantEntry(entry: SessionEntry): entry is AssistantEntry {
	if (entry.type !== "message" || typeof entry.message !== "object" || entry.message === null) return false;
	return (entry.message as Record<string, unknown>).role === "assistant";
}

export function readLatestAssistant(sessionFile: string): AssistantMessage | undefined {
	let content: string;
	try {
		content = readFileSync(sessionFile, "utf8");
	} catch {
		return undefined;
	}
	const entries: SessionEntry[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		try {
			const value: unknown = JSON.parse(line);
			if (isSessionEntry(value)) entries.push(value);
		} catch {
			// The final JSONL record may still be in the process of being appended.
		}
	}
	const branch = activeBranch(entries);
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (isAssistantEntry(entry)) return entry.message;
	}
	return undefined;
}

export function assistantText(message: AssistantMessage): string {
	if (!Array.isArray(message.content)) return message.errorMessage ?? "(no response text)";
	const parts: string[] = [];
	for (const item of message.content) {
		if (typeof item !== "object" || item === null) continue;
		const block = item as Record<string, unknown>;
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
	}
	return parts.join("\n").trim() || message.errorMessage || "(no response text)";
}
