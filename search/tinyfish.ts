import { requestJson } from "./http";
import type { SearchOptions, SearchProvider, SearchResult } from "./types";

/**
 * TinyFish Search API — https://docs.tinyfish.ai/search-api/reference
 * GET https://api.search.tinyfish.ai?query=…  with header X-API-Key. Free up to 12,000 requests/day; 30 requests/minute per key.
 * Requests are spaced ~2.1 s apart (process-wide) so batch audits stay under the per-minute limit; 429/5xx are retried with backoff.
 */
const ENDPOINT = "https://api.search.tinyfish.ai";
const MIN_GAP_MS = 2100;
let queue: Promise<unknown> = Promise.resolve();
let last = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try { return await fn(); } finally { last = Date.now(); }
  });
  queue = run.catch(() => undefined);
  return run;
}

interface TinyFishResponse {
  query?: string;
  results?: { position?: number; site_name?: string; title?: string; snippet?: string; url?: string; date?: string }[];
  total_results?: number;
  page?: number;
}

export class TinyFishProvider implements SearchProvider {
  readonly name = "tinyfish";
  constructor(private apiKey: string | undefined = process.env.TINYFISH_API_KEY, private fetchImpl: typeof fetch = fetch, private gapMs = MIN_GAP_MS) {}
  isConfigured() { return !!this.apiKey; }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const p = new URLSearchParams({ query, location: "IN", language: "en" });
    if (opts.includeDomains?.length) p.set("include_domains", opts.includeDomains.join(","));
    if (opts.excludeDomains?.length) p.set("exclude_domains", opts.excludeDomains.join(","));
    const call = () => requestJson<TinyFishResponse>(this.name, `${ENDPOINT}?${p.toString()}`, { headers: { accept: "application/json", "x-api-key": this.apiKey as string } }, { signal: opts.signal, fetchImpl: this.fetchImpl });
    const data = this.gapMs > 0 ? await throttled(call) : await call();
    const max = Math.min(opts.maxResults ?? 10, 20);
    return (data.results ?? [])
      .filter((r) => typeof r.url === "string" && /^https?:\/\//i.test(r.url))
      .slice(0, max)
      .map((r, i) => ({
        url: r.url as string,
        title: (r.title?.trim() || r.site_name || "").trim(),
        snippet: (r.snippet ?? "").trim(),
        publishedAt: r.date,
        score: 1 - (r.position ?? i + 1) / 20,
        provider: this.name,
      }));
  }
}
