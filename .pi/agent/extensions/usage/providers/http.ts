/**
 * Extract `error.message` (or a string `error`/`message`) from an error body so
 * failures like OpenCode Go's "subscription required" reach the user.
 */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    const error = body.error as { message?: unknown } | string | undefined;
    const message = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : body.message;
    return typeof message === "string" && message !== "" ? `: ${message}` : "";
  } catch {
    return "";
  }
}

/** Minimal JSON GET used by every usage provider. */
export async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const host = new URL(url).host;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    // Node wraps DNS/connection failures in a bare "fetch failed"; surface the cause and host.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot reach ${host}: ${cause}`);
  }
  if (!response.ok) {
    const status = `${response.status} ${response.statusText}`.trim();
    throw new Error(`HTTP ${status} from ${host}${await errorDetail(response)}`);
  }
  return (await response.json()) as T;
}
