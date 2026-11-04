// Subagent extension. In the parent Pi it provides the status widget and
// suspend/resume of children across parent restarts. In a child Pi
// (PI_SUBAGENT_RUN_DIR set) it reports state to metadata.json and delivers
// inbox messages. Children run in Rex terminals; the `subagent` CLI (cli.ts) spawns them.

import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	childLiveness,
	effectiveRunStateAsync,
	inboxDir,
	closeRunWindow,
	launchRun,
	listRuns,
	readMetadata,
	removeRunDir,
	runDisplayName,
	type InboxMessage,
	type RunMetadata,
	updateMetadata,
	waitForRunShutdown,
} from "./shared.ts";

const packageDir = import.meta.dirname;

function isInboxMessage(value: unknown): value is InboxMessage {
	if (typeof value !== "object" || value === null) return false;
	const message = value as Record<string, unknown>;
	return typeof message.message === "string" && (message.delivery === "auto" || message.delivery === "followUp");
}

export default function subagentExtension(pi: ExtensionAPI) {
	const runDir = process.env.PI_SUBAGENT_RUN_DIR;
	if (!runDir) {
		pi.on("resources_discover", () => ({ skillPaths: [join(packageDir, "skills")] }));

		let widgetTimer: ReturnType<typeof setInterval> | undefined;
		let widgetContext: ExtensionContext | undefined;
		let widgetRefreshing = false;

		// Liveness checks spawn one rex process per run. Run them concurrently and off
		// the event loop so the parent UI does not stall, and never overlap refreshes.
		const refreshWidget = async (): Promise<void> => {
			if (!widgetContext || widgetRefreshing) return;
			widgetRefreshing = true;
			try {
				await renderWidget();
			} finally {
				widgetRefreshing = false;
			}
		};

		const renderWidget = async (): Promise<void> => {
			if (!widgetContext) return;
			const runs = listRuns(widgetContext.sessionManager.getSessionId());
			const states = await Promise.all(runs.map((run) => effectiveRunStateAsync(run)));
			if (!widgetContext) return;
			const activeRuns = runs
				.map((run, index) => ({ run, state: states[index] }))
				.filter(({ state }) => state !== "exited");
			if (activeRuns.length === 0) {
				widgetContext.ui.setWidget("subagents", undefined);
				return;
			}

			const visible = activeRuns.slice(0, 5).map(({ run, state }) => {
				const color =
					state === "busy" ? "warning" : state === "idle" ? "success" : state === "error" ? "error" : "muted";
				return widgetContext!.ui.theme.fg(color, `${run.name ?? run.handle}:${state}`);
			});
			if (activeRuns.length > visible.length) {
				visible.push(widgetContext.ui.theme.fg("muted", `+${activeRuns.length - visible.length}`));
			}
			widgetContext.ui.setWidget(
				"subagents",
				[widgetContext.ui.theme.fg("dim", "subagents: ") + visible.join(widgetContext.ui.theme.fg("dim", " | "))],
				{ placement: "belowEditor" },
			);
		};

		pi.on("session_start", (_event, ctx) => {
			// Relaunch children that were suspended when this session was last quit or switched away from.
			for (const run of listRuns(ctx.sessionManager.getSessionId())) {
				if (!run.suspended || childLiveness(run.terminal) !== "exited") continue;
				if (!run.sessionFile || !existsSync(run.sessionFile)) {
					removeRunDir(run.runDir);
					continue;
				}
				const starting = updateMetadata(run.runDir, { state: "starting", error: undefined }) ?? run;
				try {
					launchRun(starting);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					updateMetadata(run.runDir, { state: "error", error: message });
					if (ctx.hasUI) ctx.ui.notify(`Could not resume subagent ${runDisplayName(run)}: ${message}`, "error");
				}
			}

			if (!ctx.hasUI) return;
			widgetContext = ctx;
			void refreshWidget();
			widgetTimer = setInterval(() => void refreshWidget(), 1000);
			widgetTimer.unref();
		});

		pi.on("session_shutdown", async (event, ctx) => {
			if (widgetTimer) clearInterval(widgetTimer);
			widgetTimer = undefined;
			widgetContext = undefined;
			ctx.ui.setWidget("subagents", undefined);
			if (event.reason === "reload") return;
			// Suspend running children: stop the process but keep transcript and metadata so resuming this
			// session relaunches them. Children that already exited on their own are discarded.
			for (const run of listRuns(ctx.sessionManager.getSessionId())) {
				const liveness = childLiveness(run.terminal);
				if (liveness === "exited") {
					// The Rex window outlives the child (--keep-open); remove it with the run.
					if (!run.suspended && closeRunWindow(run)) removeRunDir(run.runDir);
					continue;
				}
				// Running, or Rex could not answer. Suspend in both cases: the run and its
				// transcript stay on disk, and resume relaunches it.
				updateMetadata(run.runDir, { suspended: true });
				if (!closeRunWindow(run)) continue;
				if (liveness === "running") await waitForRunShutdown(run.runDir);
				updateMetadata(run.runDir, { terminal: undefined });
			}
		});
		return;
	}

	let currentContext: ExtensionContext | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let processing = false;
	let sessionName: string | undefined;
	// Set when a message was sent to an idle agent. isIdle() stays true until the
	// agent loop starts, so a second queued message would start a second prompt.
	// Cleared by agent_start, or after a grace period if the send never started a turn.
	let idleSendAt: number | undefined;
	const IDLE_SEND_GRACE_MS = 5000;

	const syncSessionName = (): void => {
		const metadata = readMetadata(runDir);
		if (!metadata) return;
		const next = `subagent ${metadata.name ?? metadata.handle}`;
		if (next === sessionName) return;
		pi.setSessionName(next);
		sessionName = next;
	};

	const processInbox = async (): Promise<void> => {
		if (processing || !currentContext) return;
		syncSessionName();
		if (idleSendAt !== undefined && Date.now() - idleSendAt < IDLE_SEND_GRACE_MS) return;
		idleSendAt = undefined;
		const queueDir = inboxDir(runDir);
		if (!existsSync(queueDir)) return;
		processing = true;
		try {
			for (const name of readdirSync(queueDir)
				.filter((entry) => entry.endsWith(".json"))
				.sort()) {
				const path = join(queueDir, name);
				let payload: InboxMessage;
				try {
					const value: unknown = JSON.parse(readFileSync(path, "utf8"));
					if (!isInboxMessage(value)) throw new Error("Invalid inbox message");
					payload = value;
				} catch (error) {
					unlinkSync(path);
					updateMetadata(runDir, {
						state: "error",
						error: error instanceof Error ? error.message : String(error),
					});
					continue;
				}

				updateMetadata(runDir, { state: "busy", error: undefined });
				try {
					if (currentContext.isIdle()) {
						pi.sendUserMessage(payload.message);
						unlinkSync(path);
						// Leave the rest queued. They are delivered as steer or follow-up once the turn runs.
						idleSendAt = Date.now();
						return;
					}
					pi.sendUserMessage(payload.message, {
						deliverAs: payload.delivery === "followUp" ? "followUp" : "steer",
					});
					unlinkSync(path);
				} catch (error) {
					updateMetadata(runDir, {
						state: currentContext.isIdle() ? "idle" : "busy",
						error: error instanceof Error ? error.message : String(error),
					});
					return;
				}
			}
		} finally {
			processing = false;
		}
	};

	pi.on("session_start", (_event, ctx) => {
		currentContext = ctx;
		const metadata = readMetadata(runDir);
		if (!metadata) return;
		updateMetadata(runDir, {
			childSessionId: ctx.sessionManager.getSessionId(),
			sessionFile: ctx.sessionManager.getSessionFile() ?? metadata.sessionFile,
			state: ctx.isIdle() ? "idle" : "busy",
			suspended: undefined,
			error: undefined,
		});
		syncSessionName();
		if (!timer) {
			timer = setInterval(() => void processInbox(), 250);
			timer.unref();
		}
		void processInbox();
	});

	pi.on("agent_start", (_event, ctx) => {
		currentContext = ctx;
		idleSendAt = undefined;
		updateMetadata(runDir, { state: "busy", hasStarted: true, error: undefined });
	});

	pi.on("agent_settled", (_event, ctx) => {
		currentContext = ctx;
		if (ctx.isIdle()) updateMetadata(runDir, { state: "idle" });
	});

	pi.on("session_shutdown", (event) => {
		currentContext = undefined;
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
		if (event.reason === "quit") updateMetadata(runDir, { state: "exited" });
	});
}
