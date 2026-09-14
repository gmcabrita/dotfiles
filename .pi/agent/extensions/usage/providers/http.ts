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
    throw new Error(`HTTP ${response.status} ${response.statusText} from ${host}`);
  }
  return (await response.json()) as T;
}
