import type { PageSpeedResult } from "./audit";

export type PageSpeedOutcome = PageSpeedResult | { unavailable: string };
export type PageSpeedFn = (url: string, signal?: AbortSignal) => Promise<PageSpeedOutcome>;

interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, { numericValue?: number } | undefined>;
  };
}

/**
 * Google PageSpeed Insights (mobile). Only runs when PAGESPEED_API_KEY is set; otherwise performance is
 * reported as "not measured" — never estimated.
 */
export function createPageSpeed(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): PageSpeedFn {
  const key = env.PAGESPEED_API_KEY;
  return async (url, signal) => {
    if (!key) return { unavailable: "PAGESPEED_API_KEY is not configured, so performance was not measured." };
    try {
      const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
      api.searchParams.set("url", url);
      api.searchParams.set("strategy", "mobile");
      api.searchParams.set("category", "performance");
      api.searchParams.set("key", key);
      const timeout = AbortSignal.timeout(60_000);
      const res = await fetchImpl(api.toString(), { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!res.ok) return { unavailable: `PageSpeed Insights returned HTTP ${res.status}.` };
      const j = (await res.json()) as PsiResponse;
      const score = j.lighthouseResult?.categories?.performance?.score;
      if (typeof score !== "number") return { unavailable: "PageSpeed Insights returned no performance score for this page." };
      return {
        performance: Math.round(score * 100),
        lcpMs: j.lighthouseResult?.audits?.["largest-contentful-paint"]?.numericValue ?? null,
        cls: j.lighthouseResult?.audits?.["cumulative-layout-shift"]?.numericValue ?? null,
        strategy: "mobile",
        url,
      };
    } catch (e) {
      if (signal?.aborted) throw e;
      return { unavailable: `PageSpeed Insights could not be reached (${e instanceof Error ? e.message.slice(0, 80) : "error"}).` };
    }
  };
}
