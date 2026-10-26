import { SearchProviderError } from "./types";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** JSON request with timeout and bounded retries (429/5xx, network errors). */
export async function requestJson<T>(
  provider: string,
  url: string,
  init: RequestInit,
  opts: { signal?: AbortSignal; timeoutMs?: number; retries?: number; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const { timeoutMs = 15000, retries = 2, fetchImpl = fetch } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new SearchProviderError(provider, "aborted");
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    try {
      const res = await fetchImpl(url, { ...init, signal });
      if (res.ok) return (await res.json()) as T;
      const body = (await res.text().catch(() => "")).slice(0, 200);
      if (!RETRYABLE.has(res.status) || attempt === retries) {
        throw new SearchProviderError(provider, `HTTP ${res.status} ${body}`.trim(), res.status);
      }
      lastErr = new SearchProviderError(provider, `HTTP ${res.status}`, res.status);
    } catch (e) {
      if (e instanceof SearchProviderError && !RETRYABLE.has(e.status ?? 0)) throw e;
      if (opts.signal?.aborted) throw new SearchProviderError(provider, "aborted");
      lastErr = e;
      if (attempt === retries) break;
    }
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  throw lastErr instanceof SearchProviderError
    ? lastErr
    : new SearchProviderError(provider, lastErr instanceof Error ? lastErr.message : "request failed");
}
