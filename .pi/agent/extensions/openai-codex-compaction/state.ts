import type {
  RemoteCompactionSessionState,
  ResponsesReasoningConfig,
  ResponsesTextConfig,
} from "./remote-compaction.ts";

export type ResponsesRequestShapeState = {
  reasoning?: ResponsesReasoningConfig;
  text?: ResponsesTextConfig;
};

const remoteCompactionBySessionId = new Map<string, RemoteCompactionSessionState>();
const requestShapeBySessionId = new Map<string, ResponsesRequestShapeState>();

export function getRemoteCompactionState(
  sessionId: string,
): RemoteCompactionSessionState | undefined {
  return remoteCompactionBySessionId.get(sessionId);
}

export function setRemoteCompactionState(
  sessionId: string,
  state: RemoteCompactionSessionState,
): void {
  remoteCompactionBySessionId.set(sessionId, state);
}

export function clearRemoteCompactionState(sessionId: string): void {
  remoteCompactionBySessionId.delete(sessionId);
}

export function getResponsesRequestShapeState(
  sessionId: string,
): ResponsesRequestShapeState | undefined {
  return requestShapeBySessionId.get(sessionId);
}

export function setResponsesRequestShapeState(
  sessionId: string,
  state: ResponsesRequestShapeState,
): void {
  requestShapeBySessionId.set(sessionId, state);
}

export function clearSessionState(sessionId: string): void {
  remoteCompactionBySessionId.delete(sessionId);
  requestShapeBySessionId.delete(sessionId);
}

export function clearAllState(): void {
  remoteCompactionBySessionId.clear();
  requestShapeBySessionId.clear();
}
