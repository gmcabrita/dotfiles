// Shared state and Rex helpers for the subagent extension (index.ts) and CLI (cli.ts).
//
// Control state for each run lives in ~/.pi/agent/subagents/runs/<handle>/
// (metadata.json and an inbox/ of queued messages) and is removed by `subagent stop`.
// The child's Pi transcript lives in ~/.pi/agent/subagents/sessions/ and is kept.
// The child Pi process runs in a Rex terminal block; Rex is the only process supervisor.
// All children of one parent Pi session share a Rex session, one window (tab) per child.

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
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RunState = "starting" | "busy" | "idle" | "exited" | "error";

/** Rex IDs of the terminal that hosts the child Pi process. */
export interface RexTerminal {
	/** Shared by all runs of the same parent Pi session. */
	session: string;
	/** The run's own tab in the session. */
	window: string;
	block: string;
}

export interface RunMetadata {
	version: 2;
	handle: string;
	name?: string;
	/** Short label for the parent's task. Shown in the Rex session label. */
	group?: string;
	parentSessionId?: string;
	parentSessionFile?: string;
	childSessionId?: string;
	/** Absent while the run is launching or suspended. */
	terminal?: RexTerminal;
	runDir: string;
	/** Path of the child's transcript. Reported by the child at session_start; absent until then. */
	sessionFile?: string;
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
	return join(getAgentDir(), "subagents", "runs");
}

/** Where child Pi transcripts are stored. Survives `subagent stop`. */
export function getSessionsDir(): string {
	return join(getAgentDir(), "subagents", "sessions");
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

export const MAX_GROUP_LENGTH = 24;

export function isValidGroupLabel(value: unknown): value is string {
	return isValidRunName(value) && value.length <= MAX_GROUP_LENGTH;
}

/**
 * Group label of the earliest run of the same parent. All runs of one parent share
 * one Rex session, so the first spawn sets the label and later spawns reuse it.
 */
export function existingParentGroup(parentSessionId: string | undefined): string | undefined {
	if (!parentSessionId) return undefined;
	return listRuns(parentSessionId).find((run) => run.group)?.group;
}

export function runDisplayName(metadata: RunMetadata): string {
	return metadata.name ? `${metadata.name} (${metadata.handle})` : metadata.handle;
}

/** Label of the run's tab in the shared Rex session. */
export function rexWindowLabel(metadata: RunMetadata): string {
	return `subagent ${metadata.name ?? metadata.handle}`;
}

/** Label shown in the Rex sidebar for the session that holds a parent's runs. */
function rexSessionLabel(metadata: RunMetadata): string {
	const base = `subagents ${basename(metadata.cwd)}`;
	const parentLabel = metadata.group ?? metadata.parentSessionId?.slice(0, 6);
	return parentLabel ? `${base} · ${parentLabel}` : base;
}

function isRexTerminal(value: unknown): value is RexTerminal {
	if (typeof value !== "object" || value === null) return false;
	const terminal = value as Record<string, unknown>;
	return (
		typeof terminal.session === "string" &&
		typeof terminal.window === "string" &&
		typeof terminal.block === "string"
	);
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
			(metadata.group !== undefined && !isValidGroupLabel(metadata.group)) ||
			(metadata.terminal !== undefined && !isRexTerminal(metadata.terminal)) ||
			(metadata.sessionFile !== undefined && typeof metadata.sessionFile !== "string") ||
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

// Rex calls made while the parent session lock is held can each take up to the
// rex default timeout of 10s, so these limits are longer than the metadata lock's.
const REX_SESSION_LOCK_WAIT_MS = 30_000;
const REX_SESSION_LOCK_STALE_MS = 60_000;

/**
 * Run `fn` while holding the lock directory `lockDir`. mkdir is atomic on every
 * platform, so a lock directory is the mutex. A lock older than `staleMs` belongs
 * to a dead process and is removed.
 */
function withLock<T>(lockDir: string, waitMs: number, staleMs: number, fn: () => T): T {
	mkdirSync(dirname(lockDir), { recursive: true, mode: 0o700 });
	const deadline = Date.now() + waitMs;
	for (;;) {
		try {
			mkdirSync(lockDir);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			try {
				if (Date.now() - statSync(lockDir).mtimeMs > staleMs) rmdirSync(lockDir);
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

/** Serialize read-modify-write of metadata.json across the parent, the child, and the CLI. */
function withMetadataLock<T>(runDir: string, fn: () => T): T {
	return withLock(join(runDir, "metadata.lock"), METADATA_LOCK_WAIT_MS, METADATA_LOCK_STALE_MS, fn);
}

/**
 * Serialize creation and removal of the Rex session shared by the runs of one
 * parent. Without it, concurrent spawns from the same parent each create a session,
 * and a stop can kill the session while a spawn adds a window to it.
 */
function withParentRexSessionLock<T>(metadata: RunMetadata, fn: () => T): T {
	if (!metadata.parentSessionId) return fn();
	const lockDir = join(getAgentDir(), "subagents", "locks", `${metadata.parentSessionId}.lock`);
	return withLock(lockDir, REX_SESSION_LOCK_WAIT_MS, REX_SESSION_LOCK_STALE_MS, fn);
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

function succeededOrTargetGone(result: RexResult): boolean {
	return result.status === 0 || result.status === REX_EXIT_TARGET_NOT_FOUND;
}

/** Number of windows in a Rex session, 0 when the session is gone, undefined when Rex cannot answer. */
function rexWindowCount(session: string): number | undefined {
	const result = rex(["window", "ls", "-s", session, "--json"]);
	if (result.status === REX_EXIT_TARGET_NOT_FOUND) return 0;
	if (result.status !== 0) return undefined;
	try {
		const listing = JSON.parse(result.stdout) as { windows?: unknown };
		return Array.isArray(listing.windows) ? listing.windows.length : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Close the run's Rex window, and kill the shared session once its last window is
 * closed (Rex keeps empty sessions). Returns false when Rex reports a failure other
 * than "already gone".
 */
export function closeRunWindow(metadata: RunMetadata): boolean {
	const terminal = metadata.terminal;
	if (!terminal) return true;
	return withParentRexSessionLock(metadata, () => {
		if (!succeededOrTargetGone(rex(["window", "close", "-s", terminal.session, terminal.window]))) return false;
		if (rexWindowCount(terminal.session) === 0) rex(["kill", terminal.session]);
		return true;
	});
}

export function renameRexWindow(metadata: RunMetadata): void {
	if (!metadata.terminal) return;
	rex(["window", "rename", "-s", metadata.terminal.session, metadata.terminal.window, rexWindowLabel(metadata)]);
}

/** Rex sessions that hold other live runs of the same parent, most recent first. */
function siblingRexSessions(metadata: RunMetadata): string[] {
	if (!metadata.parentSessionId) return [];
	const sessions = listRuns(metadata.parentSessionId)
		.filter((run) => run.handle !== metadata.handle && run.terminal)
		.map((run) => run.terminal!.session)
		.reverse();
	return [...new Set(sessions)];
}

function parseJson(result: RexResult, command: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(result.stdout);
		if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
	} catch {
		// Reported below.
	}
	throw new Error(`Unexpected output from rex ${command}: ${result.stdout.trim()}`);
}

function firstBlockId(window: Record<string, unknown> | undefined): unknown {
	return Array.isArray(window?.block_ids) ? window.block_ids[0] : undefined;
}

/** Open the command in a new tab of `session`. Returns undefined when the session no longer exists. */
function openRexWindow(session: string, metadata: RunMetadata, command: string[]): RexTerminal | undefined {
	const result = rex([
		"window",
		"new",
		"-s",
		session,
		rexWindowLabel(metadata),
		"--cwd",
		metadata.cwd,
		"--keep-open",
		"--focus=false",
		"--json",
		"--",
		...command,
	]);
	if (result.status === REX_EXIT_TARGET_NOT_FOUND) return undefined;
	if (result.status !== 0) throw new Error(rexError(result, "Failed to create Rex window"));
	const created = parseJson(result, "window new");
	const block = firstBlockId(created);
	if (typeof created.window_id !== "string" || typeof block !== "string") {
		throw new Error(`rex window new did not return a window and block ID: ${result.stdout.trim()}`);
	}
	return { session, window: created.window_id, block };
}

function createRexSession(metadata: RunMetadata, command: string[]): RexTerminal {
	const result = rex([
		"new",
		rexSessionLabel(metadata),
		"--window",
		rexWindowLabel(metadata),
		"--cwd",
		metadata.cwd,
		"--keep-open",
		"--json",
		"--",
		...command,
	]);
	if (result.status !== 0) throw new Error(rexError(result, "Failed to create Rex session"));
	const created = parseJson(result, "new");
	const windows = Array.isArray(created.initial_windows) ? created.initial_windows : [];
	const firstWindow = windows[0] as Record<string, unknown> | undefined;
	const block = firstBlockId(firstWindow);
	if (typeof created.session_id !== "string" || typeof firstWindow?.window_id !== "string" || typeof block !== "string") {
		throw new Error(`rex new did not return session, window, and block IDs: ${result.stdout.trim()}`);
	}
	return { session: created.session_id, window: firstWindow.window_id, block };
}

/**
 * Start the child pi process for a run in a new tab of its parent's Rex session,
 * creating the session if needed, and store the terminal in metadata.
 * `initialArgs` are only passed on first spawn. The child does not need the terminal.
 *
 * First launch lets pi create the transcript in getSessionsDir(); the child reports
 * the path at session_start. A relaunch resumes that transcript.
 */
export function launchRun(metadata: RunMetadata, initialArgs: string[] = []): RunMetadata {
	mkdirSync(getSessionsDir(), { recursive: true, mode: 0o700 });
	const sessionArgs = metadata.sessionFile
		? ["--session", metadata.sessionFile]
		: ["--session-dir", getSessionsDir()];
	const command = [
		"env",
		`PI_SUBAGENT_RUN_DIR=${metadata.runDir}`,
		// Disable OSC 7501 program status reports from child pi processes.
		"PI_PROGRAM_STATUS=0",
		"pi",
		...sessionArgs,
		"--provider",
		metadata.provider,
		"--model",
		metadata.model,
		"--thinking",
		metadata.thinking,
		...(metadata.launchArgs ?? []),
		...initialArgs,
	];
	// Hold the lock until the terminal is in metadata, so a concurrent spawn from the
	// same parent finds this run's session in siblingRexSessions().
	return withParentRexSessionLock(metadata, () => {
		let terminal: RexTerminal | undefined;
		for (const session of siblingRexSessions(metadata)) {
			terminal = openRexWindow(session, metadata, command);
			if (terminal) break;
		}
		terminal ??= createRexSession(metadata, command);
		return updateMetadata(metadata.runDir, { terminal }) ?? { ...metadata, terminal };
	});
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
