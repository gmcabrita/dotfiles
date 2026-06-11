/**
 * Session-scoped scheduled tasks for pi.
 *
 * Claude Code-style scheduling:
 * - cron_create / cron_list / cron_delete tools
 * - /loop command for quick repeated prompts
 * - tasks persist in the current session and restore on resume while unexpired
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const STATE_TYPE = "scheduled-tasks-state";
const STATUS_KEY = "scheduled-tasks";
const MAX_TASKS = 50;
const RECURRING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 1000;
const LOOP_DEFAULT_INTERVAL = "10m";
const LOOP_PROMPT_MAX_BYTES = 25_000;

type TaskSource = "tool" | "loop" | "command";

interface CronField {
	wildcard: boolean;
	values: Set<number>;
}

interface CronSchedule {
	second: CronField;
	minute: CronField;
	hour: CronField;
	dayOfMonth: CronField;
	month: CronField;
	dayOfWeek: CronField;
	hasSeconds: boolean;
}

interface ScheduledTask {
	id: string;
	cron: string;
	prompt: string;
	recurring: boolean;
	source: TaskSource;
	createdAt: number;
	updatedAt: number;
	nextRunAt: number;
	lastRunAt?: number;
	expiresAt?: number;
}

interface PersistedState {
	version: 1;
	tasks: ScheduledTask[];
}

interface IntervalPlan {
	cron: string;
	label: string;
	note?: string;
}

function disabled(): boolean {
	return process.env.PI_DISABLE_CRON === "1" || process.env.CLAUDE_CODE_DISABLE_CRON === "1";
}

function isObject(value: unknown): value is { [key: string]: unknown } {
	return typeof value === "object" && value !== null;
}

function readString(value: { [key: string]: unknown }, key: string): string | undefined {
	const field = value[key];
	return typeof field === "string" ? field : undefined;
}

function readNumber(value: { [key: string]: unknown }, key: string): number | undefined {
	const field = value[key];
	return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function readBoolean(value: { [key: string]: unknown }, key: string): boolean | undefined {
	const field = value[key];
	return typeof field === "boolean" ? field : undefined;
}

function normalizeSource(value: string | undefined): TaskSource {
	if (value === "tool" || value === "loop" || value === "command") return value;
	return "tool";
}

function parseTask(value: unknown): ScheduledTask | null {
	if (!isObject(value)) return null;
	const id = readString(value, "id");
	const cron = readString(value, "cron");
	const prompt = readString(value, "prompt");
	const recurring = readBoolean(value, "recurring");
	const createdAt = readNumber(value, "createdAt");
	const updatedAt = readNumber(value, "updatedAt");
	const nextRunAt = readNumber(value, "nextRunAt");
	if (!id || !cron || !prompt || recurring === undefined || createdAt === undefined || updatedAt === undefined || nextRunAt === undefined) {
		return null;
	}
	return {
		id,
		cron,
		prompt,
		recurring,
		source: normalizeSource(readString(value, "source")),
		createdAt,
		updatedAt,
		nextRunAt,
		lastRunAt: readNumber(value, "lastRunAt"),
		expiresAt: readNumber(value, "expiresAt"),
	};
}

function parsePersistedState(value: unknown): PersistedState | null {
	if (!isObject(value)) return null;
	if (value.version !== 1 || !Array.isArray(value.tasks)) return null;
	const tasks = value.tasks.map(parseTask).filter((task): task is ScheduledTask => task !== null);
	return { version: 1, tasks };
}

function randomId(): string {
	return randomBytes(4).toString("hex");
}

function parseNumber(raw: string, min: number, max: number, mapSunday: boolean): number {
	if (!/^\d+$/.test(raw)) throw new Error(`Invalid cron value: ${raw}`);
	const parsed = Number(raw);
	const value = mapSunday && parsed === 7 ? 0 : parsed;
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new Error(`Cron value out of range: ${raw}`);
	}
	return value;
}

function addRange(values: Set<number>, start: number, end: number, step: number): void {
	if (step <= 0) throw new Error("Cron step must be positive");
	if (start > end) throw new Error("Cron ranges must ascend");
	for (let value = start; value <= end; value += step) values.add(value);
}

function parseCronField(raw: string, min: number, max: number, mapSunday = false): CronField {
	const values = new Set<number>();
	const wildcard = raw === "*";
	const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
	if (parts.length === 0) throw new Error("Empty cron field");

	for (const part of parts) {
		const slashParts = part.split("/");
		if (slashParts.length > 2) throw new Error(`Invalid cron field: ${raw}`);
		const base = slashParts[0];
		const stepRaw = slashParts[1];
		if (!base) throw new Error(`Invalid cron field: ${raw}`);
		const step = stepRaw === undefined ? 1 : parseNumber(stepRaw, 1, max - min + 1, false);

		if (base === "*") {
			addRange(values, min, max, step);
			continue;
		}

		const range = base.split("-");
		if (range.length === 2) {
			const startRaw = range[0];
			const endRaw = range[1];
			if (!startRaw || !endRaw) throw new Error(`Invalid cron range: ${base}`);
			addRange(
				values,
				parseNumber(startRaw, min, max, mapSunday),
				parseNumber(endRaw, min, max, mapSunday),
				step,
			);
			continue;
		}
		if (range.length > 2) throw new Error(`Invalid cron range: ${base}`);
		values.add(parseNumber(base, min, max, mapSunday));
	}

	return { wildcard, values };
}

function parseCron(expression: string): CronSchedule {
	const parts = expression.trim().replace(/\s+/g, " ").split(" ");
	if (parts.length !== 5 && parts.length !== 6) {
		throw new Error("Expected 5-field cron or 6-field cron with seconds");
	}
	const hasSeconds = parts.length === 6;
	const second = hasSeconds ? parts[0] : "0";
	const minute = hasSeconds ? parts[1] : parts[0];
	const hour = hasSeconds ? parts[2] : parts[1];
	const dayOfMonth = hasSeconds ? parts[3] : parts[2];
	const month = hasSeconds ? parts[4] : parts[3];
	const dayOfWeek = hasSeconds ? parts[5] : parts[4];
	if (!second || !minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
		throw new Error("Expected 5-field cron or 6-field cron with seconds");
	}
	return {
		second: parseCronField(second, 0, 59),
		minute: parseCronField(minute, 0, 59),
		hour: parseCronField(hour, 0, 23),
		dayOfMonth: parseCronField(dayOfMonth, 1, 31),
		month: parseCronField(month, 1, 12),
		dayOfWeek: parseCronField(dayOfWeek, 0, 7, true),
		hasSeconds,
	};
}

function fieldMatches(field: CronField, value: number): boolean {
	return field.values.has(value);
}

function scheduleMatches(schedule: CronSchedule, date: Date): boolean {
	if (!fieldMatches(schedule.second, date.getSeconds())) return false;
	if (!fieldMatches(schedule.minute, date.getMinutes())) return false;
	if (!fieldMatches(schedule.hour, date.getHours())) return false;
	if (!fieldMatches(schedule.month, date.getMonth() + 1)) return false;

	const domMatches = fieldMatches(schedule.dayOfMonth, date.getDate());
	const dowMatches = fieldMatches(schedule.dayOfWeek, date.getDay());
	if (schedule.dayOfMonth.wildcard && schedule.dayOfWeek.wildcard) return true;
	if (schedule.dayOfMonth.wildcard) return dowMatches;
	if (schedule.dayOfWeek.wildcard) return domMatches;
	return domMatches || dowMatches;
}

function nextRunAt(cron: string, afterMs: number): number {
	const schedule = parseCron(cron);
	const candidate = new Date(afterMs + (schedule.hasSeconds ? 1_000 : 60_000));
	if (schedule.hasSeconds) {
		candidate.setMilliseconds(0);
	} else {
		candidate.setSeconds(0, 0);
	}
	const deadline = afterMs + 370 * 24 * 60 * 60 * 1000;
	while (candidate.getTime() <= deadline) {
		if (scheduleMatches(schedule, candidate)) return candidate.getTime();
		if (schedule.hasSeconds) {
			candidate.setSeconds(candidate.getSeconds() + 1);
		} else {
			candidate.setMinutes(candidate.getMinutes() + 1);
		}
	}
	throw new Error("Cron expression has no matching time in the next year");
}

function formatDate(ms: number | undefined): string {
	return ms === undefined ? "unknown" : new Date(ms).toLocaleString();
}

function taskForAgent(task: ScheduledTask) {
	return {
		id: task.id,
		cron: task.cron,
		prompt: task.prompt,
		recurring: task.recurring,
		source: task.source,
		createdAt: new Date(task.createdAt).toISOString(),
		updatedAt: new Date(task.updatedAt).toISOString(),
		nextRunAt: new Date(task.nextRunAt).toISOString(),
		lastRunAt: task.lastRunAt === undefined ? null : new Date(task.lastRunAt).toISOString(),
		expiresAt: task.expiresAt === undefined ? null : new Date(task.expiresAt).toISOString(),
	};
}

function formatTask(task: ScheduledTask): string {
	const kind = task.recurring ? "recurring" : "once";
	const expires = task.expiresAt === undefined ? "" : `, expires ${formatDate(task.expiresAt)}`;
	return `${task.id} ${kind} ${task.cron} next ${formatDate(task.nextRunAt)}${expires}\n  ${task.prompt}`;
}

function dueMessage(task: ScheduledTask, finalFire: boolean): string {
	const finalLine = finalFire ? "\n\nThis recurring task reached its seven-day expiry and was deleted after this final fire." : "";
	return `Scheduled task ${task.id} fired.\nSchedule: ${task.cron}\nKind: ${task.recurring ? "recurring" : "once"}\n\n${task.prompt}${finalLine}`;
}

function updateStatus(ctx: ExtensionContext, tasks: ScheduledTask[]): void {
	if (!ctx.hasUI) return;
	if (disabled()) {
		ctx.ui.setStatus(STATUS_KEY, "cron off");
		return;
	}
	if (tasks.length === 0) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const ordered = [...tasks].sort((a, b) => a.nextRunAt - b.nextRunAt);
	const next = ordered[0];
	const suffix = next ? ` next ${new Date(next.nextRunAt).toLocaleTimeString()}` : "";
	ctx.ui.setStatus(STATUS_KEY, `cron ${tasks.length}${suffix}`);
}

function buildTask(cron: string, prompt: string, recurring: boolean, source: TaskSource): ScheduledTask {
	const normalizedCron = cron.trim().replace(/\s+/g, " ");
	const normalizedPrompt = prompt.trim();
	if (!normalizedPrompt) throw new Error("Prompt must not be empty");
	parseCron(normalizedCron);
	const now = Date.now();
	return {
		id: randomId(),
		cron: normalizedCron,
		prompt: normalizedPrompt,
		recurring,
		source,
		createdAt: now,
		updatedAt: now,
		nextRunAt: nextRunAt(normalizedCron, now),
		expiresAt: recurring ? now + RECURRING_TTL_MS : undefined,
	};
}

function candidateIntervals(): IntervalPlan[] {
	const plans: IntervalPlan[] = [];
	for (const second of [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30]) {
		plans.push({ cron: `*/${second} * * * * *`, label: `${second}s` });
	}
	for (const minute of [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30]) {
		plans.push({ cron: `*/${minute} * * * *`, label: `${minute}m` });
	}
	plans.push({ cron: "0 * * * *", label: "1h" });
	for (const hour of [2, 3, 4, 6, 8, 12]) plans.push({ cron: `0 */${hour} * * *`, label: `${hour}h` });
	plans.push({ cron: "0 0 * * *", label: "1d" });
	return plans;
}

function labelSeconds(label: string): number {
	const unit = label.slice(-1);
	const amount = Number(label.slice(0, -1));
	if (unit === "s") return amount;
	if (unit === "m") return amount * 60;
	if (unit === "h") return amount * 60 * 60;
	return amount * 24 * 60 * 60;
}

function intervalSeconds(amountRaw: string, unitRaw: string): number {
	const amount = Number(amountRaw);
	if (!Number.isInteger(amount) || amount <= 0) throw new Error(`Invalid interval: ${amountRaw}${unitRaw}`);
	const unit = unitRaw.toLowerCase();
	if (unit.startsWith("s")) return amount;
	if (unit.startsWith("m")) return amount * 60;
	if (unit.startsWith("h")) return amount * 60 * 60;
	if (unit.startsWith("d")) return amount * 24 * 60 * 60;
	throw new Error(`Invalid interval unit: ${unitRaw}`);
}

function intervalToCron(amountRaw: string, unitRaw: string): IntervalPlan {
	const seconds = intervalSeconds(amountRaw, unitRaw);
	const plans = candidateIntervals();
	let best = plans[0];
	for (const plan of plans) {
		if (!best || Math.abs(labelSeconds(plan.label) - seconds) < Math.abs(labelSeconds(best.label) - seconds)) {
			best = plan;
		}
	}
	if (!best) throw new Error("No interval candidates available");
	const requested = `${amountRaw}${unitRaw}`;
	const note = labelSeconds(best.label) === seconds ? undefined : `Rounded ${requested} to ${best.label}.`;
	return { ...best, note };
}

function parseLoopArgs(args: string | undefined): { plan: IntervalPlan; prompt?: string; note?: string } {
	const trimmed = args?.trim() ?? "";
	const leading = /^(\d+)\s*([smhd])\b\s*(.*)$/i.exec(trimmed);
	if (leading) {
		const amount = leading[1];
		const unit = leading[2];
		if (amount && unit) {
			const plan = intervalToCron(amount, unit);
			return { plan, prompt: (leading[3] ?? "").trim() || undefined, note: plan.note };
		}
	}

	const trailing = /(?:^|\s)every\s+(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\s*$/i.exec(trimmed);
	if (trailing && trailing.index !== undefined) {
		const amount = trailing[1];
		const unit = trailing[2];
		if (amount && unit) {
			const plan = intervalToCron(amount, unit);
			return { plan, prompt: trimmed.slice(0, trailing.index).trim() || undefined, note: plan.note };
		}
	}

	const plan = intervalToCron(LOOP_DEFAULT_INTERVAL.slice(0, -1), LOOP_DEFAULT_INTERVAL.slice(-1));
	return { plan, prompt: trimmed || undefined, note: `No interval supplied. Using ${LOOP_DEFAULT_INTERVAL}.` };
}

async function readFirstExisting(paths: string[]): Promise<string | null> {
	for (const candidate of paths) {
		try {
			return await fs.readFile(candidate, "utf8");
		} catch {
			// Try next path.
		}
	}
	return null;
}

function truncatePrompt(text: string): string {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.byteLength <= LOOP_PROMPT_MAX_BYTES) return text.trim();
	return `${bytes.subarray(0, LOOP_PROMPT_MAX_BYTES).toString("utf8").trim()}\n\n[loop.md truncated to ${LOOP_PROMPT_MAX_BYTES} bytes]`;
}

async function defaultLoopPrompt(cwd: string): Promise<string> {
	const configured = await readFirstExisting([
		path.join(cwd, ".pi", "loop.md"),
		path.join(os.homedir(), ".pi", "agent", "loop.md"),
		path.join(cwd, ".claude", "loop.md"),
		path.join(os.homedir(), ".claude", "loop.md"),
	]);
	if (configured && configured.trim()) return truncatePrompt(configured);
	return "Continue any unfinished work from this conversation. If there is an active PR, check CI and review comments, then address failures or comments. If nothing is pending, do a small cleanup or bug-hunt pass. Do not start unrelated new work.";
}

function stateFromSession(ctx: ExtensionContext): PersistedState {
	const entries = ctx.sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type === "custom" && entry.customType === STATE_TYPE) {
			const state = parsePersistedState(entry.data);
			if (state) return state;
		}
	}
	return { version: 1, tasks: [] };
}

function restoreTasks(tasks: ScheduledTask[]): ScheduledTask[] {
	const now = Date.now();
	const restored: ScheduledTask[] = [];
	for (const task of tasks) {
		try {
			parseCron(task.cron);
		} catch {
			continue;
		}
		if (task.recurring) {
			const expiresAt = task.expiresAt ?? task.createdAt + RECURRING_TTL_MS;
			if (expiresAt <= now) continue;
			const nextRun = task.nextRunAt <= now ? nextRunAt(task.cron, now) : task.nextRunAt;
			restored.push({ ...task, expiresAt, nextRunAt: nextRun });
			continue;
		}
		if (task.nextRunAt > now) restored.push(task);
	}
	return restored.slice(0, MAX_TASKS);
}

export default function scheduledTasksExtension(pi: ExtensionAPI): void {
	let tasks: ScheduledTask[] = [];
	let timer: ReturnType<typeof setInterval> | null = null;
	let checking = false;

	function persist(): void {
		pi.appendEntry(STATE_TYPE, { version: 1, tasks });
	}

	function setTasks(nextTasks: ScheduledTask[], ctx: ExtensionContext): void {
		tasks = nextTasks;
		persist();
		updateStatus(ctx, tasks);
	}

	function addTask(task: ScheduledTask, ctx: ExtensionContext): ScheduledTask {
		if (disabled()) throw new Error("Scheduled tasks disabled by PI_DISABLE_CRON or CLAUDE_CODE_DISABLE_CRON");
		if (tasks.length >= MAX_TASKS) throw new Error(`Scheduled task limit reached (${MAX_TASKS})`);
		setTasks([...tasks, task], ctx);
		return task;
	}

	function deleteTask(id: string, ctx: ExtensionContext): ScheduledTask | null {
		const normalized = id.trim();
		const existing = tasks.find((task) => task.id === normalized);
		if (!existing) return null;
		setTasks(tasks.filter((task) => task.id !== normalized), ctx);
		return existing;
	}

	function fireTask(task: ScheduledTask, ctx: ExtensionContext): void {
		const now = Date.now();
		const finalFire = task.recurring && (task.expiresAt ?? task.createdAt + RECURRING_TTL_MS) <= now;
		const remaining = tasks.filter((candidate) => candidate.id !== task.id);
		if (task.recurring && !finalFire) {
			const updated = {
				...task,
				lastRunAt: now,
				updatedAt: now,
				nextRunAt: nextRunAt(task.cron, now),
			};
			setTasks([...remaining, updated].sort((a, b) => a.nextRunAt - b.nextRunAt), ctx);
		} else {
			setTasks(remaining, ctx);
		}

		if (ctx.hasUI) ctx.ui.notify(`Scheduled task ${task.id} fired`, "info");
		pi.sendUserMessage(dueMessage(task, finalFire));
	}

	function checkDue(ctx: ExtensionContext): void {
		if (checking || disabled()) return;
		if (!ctx.isIdle()) return;
		const due = tasks
			.filter((task) => task.nextRunAt <= Date.now())
			.sort((a, b) => a.nextRunAt - b.nextRunAt)[0];
		if (!due) return;
		checking = true;
		try {
			fireTask(due, ctx);
		} finally {
			checking = false;
		}
	}

	function startTimer(ctx: ExtensionContext): void {
		if (timer) clearInterval(timer);
		timer = setInterval(() => checkDue(ctx), CHECK_INTERVAL_MS);
	}

	pi.registerTool({
		name: "cron_create",
		label: "CronCreate",
		description: "Schedule a session-scoped prompt. Accepts a 5-field cron expression or a 6-field cron expression with seconds, prompt, and recurring flag. Tasks require pi to stay open and idle to fire.",
		promptSnippet: "Schedule a session-scoped prompt using a 5-field cron expression or 6-field expression with seconds",
		promptGuidelines: [
			"Use cron_create when the user asks to remind them later, poll something, check back at a time, or schedule repeated work in this pi session.",
			"cron_create times use local timezone and 5-field cron syntax: minute hour day-of-month month day-of-week, or 6-field syntax: second minute hour day-of-month month day-of-week.",
		],
		parameters: Type.Object({
			cron: Type.String({ description: "5-field cron expression, or 6-field with seconds: second minute hour day-of-month month day-of-week" }),
			prompt: Type.String({ description: "Prompt to send when the task fires" }),
			recurring: Type.Boolean({ description: "true for repeated tasks, false for one-shot reminders" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const task = addTask(buildTask(params.cron, params.prompt, params.recurring, "tool"), ctx);
			return {
				content: [{ type: "text", text: JSON.stringify(taskForAgent(task), null, 2) }],
				details: { action: "create", task: taskForAgent(task) },
			};
		},
	});

	pi.registerTool({
		name: "cron_list",
		label: "CronList",
		description: "List session-scoped scheduled tasks with IDs, schedules, next fire times, and prompts.",
		promptSnippet: "List session-scoped scheduled tasks",
		promptGuidelines: ["Use cron_list when the user asks what reminders, loops, scheduled tasks, or cron jobs are active in this pi session."],
		parameters: Type.Object({}),
		async execute() {
			const serialized = tasks.map(taskForAgent);
			return {
				content: [{ type: "text", text: JSON.stringify(serialized, null, 2) }],
				details: { action: "list", tasks: serialized },
			};
		},
	});

	pi.registerTool({
		name: "cron_delete",
		label: "CronDelete",
		description: "Cancel a session-scoped scheduled task by ID.",
		promptSnippet: "Cancel a scheduled task by ID",
		promptGuidelines: ["Use cron_delete when the user asks to cancel, stop, or delete a scheduled task, reminder, or loop."],
		parameters: Type.Object({
			id: Type.String({ description: "8-character scheduled task ID" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const deleted = deleteTask(params.id, ctx);
			if (!deleted) {
				return {
					content: [{ type: "text", text: `No scheduled task found for id ${params.id}` }],
					details: { action: "delete", deleted: false, id: params.id },
				};
			}
			return {
				content: [{ type: "text", text: `Deleted scheduled task ${deleted.id}` }],
				details: { action: "delete", deleted: true, task: taskForAgent(deleted) },
			};
		},
	});

	pi.registerCommand("loop", {
		description: "Run a prompt repeatedly on a cron schedule. Usage: /loop 5m check deploy | /loop check deploy | /loop",
		handler: async (args, ctx) => {
			try {
				const parsed = parseLoopArgs(args);
				const prompt = parsed.prompt ?? await defaultLoopPrompt(ctx.cwd);
				const task = addTask(buildTask(parsed.plan.cron, prompt, true, "loop"), ctx);
				const note = parsed.note ? `${parsed.note}\n` : "";
				ctx.ui.notify(`${note}Loop ${task.id} scheduled: ${parsed.plan.label}`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Loop not scheduled: ${message}`, "error");
			}
		},
	});

	pi.registerCommand("cron", {
		description: "Manage scheduled tasks. Usage: /cron list | /cron clear | /cron delete <id> | /cron create <5-or-6-field cron> once|recurring <prompt>",
		handler: async (args, ctx) => {
			const trimmed = args?.trim() || "list";
			const parts = trimmed.split(/\s+/);
			const action = parts[0] ?? "list";
			try {
				if (action === "list" || action === "ls") {
					ctx.ui.notify(tasks.length ? tasks.map(formatTask).join("\n\n") : "No scheduled tasks.", "info");
					return;
				}
				if (action === "delete" || action === "del" || action === "rm") {
					const id = parts[1];
					if (!id) throw new Error("id required");
					const deleted = deleteTask(id, ctx);
					ctx.ui.notify(deleted ? `Deleted ${deleted.id}` : `No task ${id}`, deleted ? "info" : "warning");
					return;
				}
				if (action === "clear") {
					const count = tasks.length;
					setTasks([], ctx);
					ctx.ui.notify(count === 0 ? "No scheduled tasks." : `Cleared ${count} scheduled task${count === 1 ? "" : "s"}.`, "info");
					return;
				}
				if (action === "create") {
					const recurrenceIndex = parts.findIndex((part, index) => index > 0 && (part === "once" || part === "recurring"));
					if (recurrenceIndex === -1) throw new Error("use once or recurring after cron expression");
					const cronParts = parts.slice(1, recurrenceIndex);
					if (cronParts.length !== 5 && cronParts.length !== 6) throw new Error("create requires 5 cron fields, or 6 fields with seconds");
					const recurrence = parts[recurrenceIndex];
					if (recurrence !== "once" && recurrence !== "recurring") throw new Error("use once or recurring after cron expression");
					const prompt = parts.slice(recurrenceIndex + 1).join(" ").trim();
					const task = addTask(buildTask(cronParts.join(" "), prompt, recurrence === "recurring", "command"), ctx);
					ctx.ui.notify(`Created ${task.id}`, "info");
					return;
				}
				ctx.ui.notify("Usage: /cron list | /cron clear | /cron delete <id> | /cron create <5-or-6-field cron> once|recurring <prompt>", "warning");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Cron error: ${message}`, "error");
			}
		},
	});

	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\nScheduled tasks are available through cron_create, cron_list, and cron_delete. Use them when the user asks for reminders, polling, scheduled checks, or task cancellation. Scheduled tasks are session-scoped, fire only while pi is running, and use local time.`,
	}));

	pi.on("agent_end", async (_event, ctx) => {
		checkDue(ctx);
	});

	pi.on("session_start", async (_event, ctx) => {
		tasks = restoreTasks(stateFromSession(ctx).tasks);
		persist();
		updateStatus(ctx, tasks);
		startTimer(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (timer) clearInterval(timer);
		timer = null;
	});
}
