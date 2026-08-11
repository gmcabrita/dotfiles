import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CodexModel } from "./model.ts";
import {
  applyRemoteHistoryPayloadPatch,
  extractResponsesReasoningConfig,
  extractResponsesTextConfig,
  isRecord,
  isSupportedCodexModel,
  looksLikeResponsesPayload,
  messageMatchesModel,
  modelKey,
  thinkingLevelToResponsesReasoning,
} from "./model.ts";
import {
  buildCompactionSummaryText,
  buildRemoteCompactionDetails,
  buildToolsPayload,
  callRemoteCompactionEndpoint,
  generateBestEffortLocalSummary,
  messageToResponseItems,
  messagesToResponseItems,
  normalizeResponseItemsForPrompt,
  reconstructRemoteCompactionStateFromBranch,
  type RemoteCompactionSessionState,
} from "./remote-compaction.ts";
import {
  clearAllState,
  clearRemoteCompactionState,
  clearSessionState,
  getRemoteCompactionState,
  getResponsesRequestShapeState,
  setRemoteCompactionState,
  setResponsesRequestShapeState,
} from "./state.ts";

type BranchEntry = {
  type: string;
  id: string;
  details?: unknown;
  message?: AgentMessage;
  thinkingLevel?: unknown;
};

type SessionContext = {
  sessionManager: {
    getSessionId(): string;
    getBranch(): BranchEntry[];
  };
};

function getSessionId(ctx: SessionContext): string {
  return ctx.sessionManager.getSessionId();
}

function definedHeaders(
  headers: Record<string, string | null> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== null),
  );
}

function getBranchMessages(entries: BranchEntry[]): AgentMessage[] {
  return entries.flatMap((entry) =>
    entry.type === "message" && entry.message ? [entry.message] : [],
  );
}

function getBranchThinkingLevel(entries: BranchEntry[]): ThinkingLevel | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "thinking_level_change") continue;
    return typeof entry.thinkingLevel === "string"
      ? (entry.thinkingLevel as ThinkingLevel)
      : undefined;
  }
  return undefined;
}

function syncRemoteState(ctx: SessionContext): void {
  const sessionId = getSessionId(ctx);
  const state = reconstructRemoteCompactionStateFromBranch({
    branchEntries: ctx.sessionManager.getBranch(),
  });

  if (state) {
    setRemoteCompactionState(sessionId, state);
  } else {
    clearRemoteCompactionState(sessionId);
  }
}

function matchingRemoteState(
  sessionId: string,
  model: CodexModel | undefined,
): RemoteCompactionSessionState | undefined {
  if (!model) return undefined;
  const state = getRemoteCompactionState(sessionId);
  return state?.modelKey === modelKey(model) ? state : undefined;
}

function extendRemoteHistory(
  sessionId: string,
  model: CodexModel | undefined,
  message: AgentMessage,
): void {
  const state = matchingRemoteState(sessionId, model);
  if (!state || !model) return;
  if (message.role === "assistant" && !messageMatchesModel(message, model)) return;

  const items = messageToResponseItems(message);
  if (items.length === 0) return;

  setRemoteCompactionState(sessionId, {
    ...state,
    explicitHistory: [...state.explicitHistory, ...items],
  });
}

/** Always enables Codex remote compaction for openai-codex and openai-codex-lb. */
export default function openAICodexCompactionExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    clearSessionState(getSessionId(ctx));
    syncRemoteState(ctx);
  });

  const clearBeforeSessionChange = (_event: unknown, ctx: SessionContext): void => {
    clearSessionState(getSessionId(ctx));
  };
  pi.on("session_before_switch", clearBeforeSessionChange);
  pi.on("session_before_fork", clearBeforeSessionChange);
  pi.on("session_before_tree", clearBeforeSessionChange);

  pi.on("session_tree", (_event, ctx) => syncRemoteState(ctx));
  pi.on("session_compact", (_event, ctx) => syncRemoteState(ctx));
  pi.on("session_shutdown", () => clearAllState());

  pi.on("session_before_compact", async (event, ctx) => {
    const model = ctx.model;
    if (!isSupportedCodexModel(model)) return;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return;

    const headers = definedHeaders(auth.headers);
    const streamFn = ctx.modelRegistry.getProvider(model.provider)?.streamSimple;
    const sessionId = getSessionId(ctx);
    const branchEntries = event.branchEntries as BranchEntry[];
    const fullBranchMessages = getBranchMessages(branchEntries);
    const remoteState = matchingRemoteState(sessionId, model);
    const responseItems = remoteState
      ? remoteState.explicitHistory
      : messagesToResponseItems(fullBranchMessages);
    const observedRequestShape = getResponsesRequestShapeState(sessionId);
    const thinkingLevel = pi.getThinkingLevel() ?? getBranchThinkingLevel(branchEntries);
    const reasoning =
      observedRequestShape?.reasoning ??
      thinkingLevelToResponsesReasoning(model, thinkingLevel);

    const [localResult, remoteResult] = await Promise.allSettled([
      generateBestEffortLocalSummary({
        preparation: event.preparation,
        messages: fullBranchMessages,
        model,
        apiKey: auth.apiKey,
        headers,
        customInstructions: event.customInstructions,
        signal: event.signal,
        thinkingLevel,
        completeModel: (summaryModel, context, options) =>
          ctx.modelRegistry.complete(summaryModel, context, options),
        streamFn,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      }),
      callRemoteCompactionEndpoint({
        model,
        apiKey: auth.apiKey,
        headers,
        sessionId,
        input: normalizeResponseItemsForPrompt(responseItems, model),
        instructions: ctx.getSystemPrompt(),
        tools: buildToolsPayload(pi.getAllTools(), pi.getActiveTools()),
        parallelToolCalls: true,
        reasoning,
        text: observedRequestShape?.text,
        signal: event.signal,
      }),
    ]);

    if (remoteResult.status !== "fulfilled") {
      if (localResult.status === "fulfilled") {
        return { compaction: localResult.value };
      }
      if (!event.signal.aborted && ctx.hasUI) {
        const reason =
          remoteResult.reason instanceof Error
            ? remoteResult.reason.message
            : String(remoteResult.reason);
        ctx.ui.notify(
          `OpenAI Codex remote compaction failed. Pi will use default compaction. ${reason}`,
          "warning",
        );
      }
      return;
    }

    const localSummary =
      localResult.status === "fulfilled"
        ? localResult.value
        : {
            summary: buildCompactionSummaryText(model),
            firstKeptEntryId: event.preparation.firstKeptEntryId,
            tokensBefore: event.preparation.tokensBefore,
          };

    return {
      compaction: {
        summary: localSummary.summary,
        firstKeptEntryId: localSummary.firstKeptEntryId,
        tokensBefore: localSummary.tokensBefore,
        details: {
          ...(localSummary.details === undefined
            ? {}
            : { localSummaryDetails: localSummary.details }),
          remoteCompaction: buildRemoteCompactionDetails(
            model,
            remoteResult.value.output,
            remoteResult.value.usage,
          ),
        },
      },
    };
  });

  pi.on("message_end", (event, ctx) => {
    const model = isSupportedCodexModel(ctx.model) ? ctx.model : undefined;
    extendRemoteHistory(getSessionId(ctx), model, event.message);
  });

  pi.on("before_provider_request", (event, ctx) => {
    const model = ctx.model;
    if (
      !isSupportedCodexModel(model) ||
      !isRecord(event.payload) ||
      !looksLikeResponsesPayload(event.payload)
    ) {
      return;
    }

    const sessionId = getSessionId(ctx);
    setResponsesRequestShapeState(sessionId, {
      reasoning: extractResponsesReasoningConfig(event.payload),
      text: extractResponsesTextConfig(event.payload),
    });

    const remoteState = matchingRemoteState(sessionId, model);
    if (!remoteState) return;

    return applyRemoteHistoryPayloadPatch(
      event.payload,
      normalizeResponseItemsForPrompt(remoteState.explicitHistory, model),
    );
  });
}
