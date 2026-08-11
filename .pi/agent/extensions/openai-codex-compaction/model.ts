import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ResponseItem, ResponsesReasoningConfig, ResponsesTextConfig } from "./remote-compaction.ts";

const OPENAI_CODEX_PROVIDER = "openai-codex";
const OPENAI_CODEX_API = "openai-codex-responses";
const OPENAI_CODEX_LB_PROVIDER = "openai-codex-lb";
const OPENAI_CODEX_LB_API = "openai-codex-lb-responses";

export type CodexModel = Model<any>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isOpenAICodexModel(model: unknown): model is CodexModel {
  return (
    isRecord(model) &&
    model.provider === OPENAI_CODEX_PROVIDER &&
    model.api === OPENAI_CODEX_API
  );
}

export function isOpenAICodexLbModel(model: unknown): model is CodexModel {
  return (
    isRecord(model) &&
    model.provider === OPENAI_CODEX_LB_PROVIDER &&
    model.api === OPENAI_CODEX_LB_API
  );
}

export function isSupportedCodexModel(model: unknown): model is CodexModel {
  return isOpenAICodexModel(model) || isOpenAICodexLbModel(model);
}

export function modelKey(model: Pick<CodexModel, "provider" | "api" | "id">): string {
  return `${model.provider}:${model.api}:${model.id}`;
}

export function messageMatchesModel(message: unknown, model: CodexModel): boolean {
  return (
    isRecord(message) &&
    message.role === "assistant" &&
    message.provider === model.provider &&
    message.model === model.id
  );
}

export function looksLikeResponsesPayload(payload: Record<string, unknown>): boolean {
  return "input" in payload || "model" in payload || "messages" in payload;
}

export function applyRemoteHistoryPayloadPatch(
  payload: Record<string, unknown>,
  explicitHistory: ResponseItem[],
): Record<string, unknown> {
  const nextPayload: Record<string, unknown> = {
    ...payload,
    input: explicitHistory,
  };
  delete nextPayload.messages;
  delete nextPayload.previous_response_id;
  return nextPayload;
}

export function extractResponsesReasoningConfig(
  payload: unknown,
): ResponsesReasoningConfig | undefined {
  if (!isRecord(payload) || !isRecord(payload.reasoning)) return undefined;

  const effort = payload.reasoning.effort;
  const summary = payload.reasoning.summary;
  const normalized: ResponsesReasoningConfig = {
    ...(typeof effort === "string"
      ? { effort: effort as ResponsesReasoningConfig["effort"] }
      : {}),
    ...(summary === null || typeof summary === "string"
      ? { summary: summary as ResponsesReasoningConfig["summary"] }
      : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function extractResponsesTextConfig(payload: unknown): ResponsesTextConfig | undefined {
  return isRecord(payload) && isRecord(payload.text) ? payload.text : undefined;
}

export function thinkingLevelToResponsesReasoning(
  model: CodexModel,
  thinkingLevel: ThinkingLevel | undefined,
): ResponsesReasoningConfig | undefined {
  if (!thinkingLevel || thinkingLevel === "off") return undefined;

  const mapped = model.thinkingLevelMap?.[thinkingLevel] ?? thinkingLevel;
  if (mapped === null || mapped === "off" || mapped === "none") return undefined;
  if (!["minimal", "low", "medium", "high", "xhigh", "max"].includes(mapped)) {
    return undefined;
  }

  return {
    effort: mapped as ResponsesReasoningConfig["effort"],
    summary: "auto",
  };
}
