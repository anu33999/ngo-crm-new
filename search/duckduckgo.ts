import * as cheerio from "cheerio";
import type { SearchOptions, SearchProvider, SearchResult } from "./types";
import { SearchProviderError } from "./types";

/**
 * Keyless search via DuckDuckGo's HTML endpoint (html.duckduckgo.com — its robots.txt allows all paths).
 * Used automatically when no search API key is set. Best-effort: requests are spaced out (one every ~2.5 s, one at a time),
 * results are cached by the pipeline, ads are skipped, and if DuckDuckGo asks for a human check we stop and say so instead
 * of retrying. For heavy use, a Tavily/Brave/Google key is more reliable.
 */
const ENDPOINT = "https://html.duckduckgo.com/html/";
const MIN_GAP_MS = 2500;
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

/** DuckDuckGo wraps result links as //duckduckgo.com/l/?uddg=<encoded target>. */
export function unwrapDdgUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const target = u.hostname.endsWith("duckduckgo.com") && u.pathname === "/l/" ? u.searchParams.get("uddg") : u.toString();
    if (!target) return null;
    const t = new URL(target);
    if (!/^https?:$/.test(t.protocol) || t.hostname.endsWith("duckduckgo.com")) return null;
    return t.toString();
  } catch { return null; }
}

/** Parses the HTML results page. Exported for tests. Throws when the page is a bot check rather than results. */
export function parseDdgHtml(html: string, max = 10): SearchResult[] {
  if (/anomaly-modal|anomaly\.js|Unfortunately, bots use DuckDuckGo too/i.test(html)) {
    throw new SearchProviderError("duckduckgo", "DuckDuckGo asked for a human check (too many automated searches). Wait a few minutes and retry, or add a search API key.", 429);
  }
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  $(".result").each((_, el) => {
    if (out.length >= max) return;
    const r = $(el);
    if (r.hasClass("result--ad") || r.find(".badge--ad").length) return;
    const a = r.find("a.result__a").first();
    const url = unwrapDdgUrl(a.attr("href"));
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({
      url,
      title: a.text().replace(/\s+/g, " ").trim(),
      snippet: r.find(".result__snippet").first().text().replace(/\s+/g, " ").trim(),
      score: 1 - out.length / 20,
      provider: "duckduckgo",
    });
  });
  return out;
}

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = "duckduckgo";
  constructor(private enabled = true, private fetchImpl: typeof fetch = fetch) {}
  isConfigured() { return this.enabled; }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const q = opts.includeDomains?.length ? `${query} ${opts.includeDomains.map((d) => `site:${d}`).join(" OR ")}` : query;
    return throttled(async () => {
      const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
      let res: Response;
      try {
        res = await this.fetchImpl(`${ENDPOINT}?q=${encodeURIComponent(q)}&kl=in-en`, {
          headers: {
            "user-agent": `Mozilla/5.0 (compatible; KreatifAtelierResearchBot/1.0; +${process.env.APP_URL ?? "https://www.kreatifatelier.com"})`,
            accept: "text/html", "accept-language": "en-IN,en;q=0.8",
          },
          signal,
        });
      } catch (e) {
        throw new SearchProviderError(this.name, e instanceof Error ? e.message : "request failed");
      }
      // 202 is DuckDuckGo's "slow down" response.
      if (res.status === 202 || res.status === 429) throw new SearchProviderError(this.name, "DuckDuckGo is rate-limiting searches. Wait a few minutes and retry, or add a search API key.", 429);
      if (!res.ok) throw new SearchProviderError(this.name, `HTTP ${res.status}`, res.status);
      return parseDdgHtml(await res.text(), Math.min(opts.maxResults ?? 10, 20));
    });
  }
}
