import { describe, expect, it } from "vitest";
import { referenceCatalogue } from "@/lib/catalogue";
import { MemoryResearchStore } from "@/lib/research/memory-store";
import { startResearch } from "@/lib/research/runner";
import { getProviderChain } from "@/lib/search";
import { DuckDuckGoProvider, parseDdgHtml, unwrapDdgUrl } from "@/lib/search/duckduckgo";
import { canonicalUrl } from "@/lib/search/normalize";
import { DONATE_PAGE, HOME_RICH } from "./fixtures/html";

// Shape of html.duckduckgo.com/html/ results (ads, wrapped links, bold snippet text).
const PAGE = `<html><body><div id="links" class="results">
<div class="result results_links results_links_deep result--ad"><div class="links_main result__body"><h2 class="result__title"><a class="result__a" href="https://duckduckgo.com/y.js?ad_provider=x&u3=https%3A%2F%2Fads.example.com">Sponsored</a></h2></div></div>
<div class="result results_links results_links_deep web-result"><div class="links_main links_deep result__body">
 <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fyouth4jobs.org%2F&amp;rut=abc">Youth4Jobs | <b>Skilling</b> youth with disabilities</a></h2>
 <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fyouth4jobs.org%2F">Youth4Jobs works with <b>youth</b> with disabilities across India.</a></div></div>
<div class="result results_links web-result"><div class="result__body"><h2 class="result__title"><a class="result__a" href="https://www.facebook.com/youth4jobs">Youth4Jobs - Facebook</a></h2><a class="result__snippet">Page</a></div></div>
<div class="result results_links web-result"><div class="result__body"><h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fyouth4jobs.org%2F&amp;rut=dup">dup</a></h2></div></div>
</div></body></html>`;

describe("keyless search (DuckDuckGo HTML)", () => {
  it("parses organic results, unwraps redirect links, skips ads and duplicates", () => {
    const r = parseDdgHtml(PAGE);
    expect(r.map((x) => x.url)).toEqual(["https://youth4jobs.org/", "https://www.facebook.com/youth4jobs"]);
    expect(r[0].title).toBe("Youth4Jobs | Skilling youth with disabilities");
    expect(r[0].snippet).toMatch(/youth with disabilities across India/);
    expect(r[0].provider).toBe("duckduckgo");
  });
  it("stops with a clear message on a bot check instead of returning nothing", () => {
    expect(() => parseDdgHtml('<div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div>')).toThrow(/human check/);
  });
  it("only accepts http(s) targets outside duckduckgo.com", () => {
    expect(unwrapDdgUrl("//duckduckgo.com/l/?uddg=javascript%3Aalert(1)")).toBeNull();
    expect(unwrapDdgUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fx")).toBeNull();
    expect(unwrapDdgUrl(undefined)).toBeNull();
  });
  it("maps a 202 'slow down' response to a rate-limit error", async () => {
    const p = new DuckDuckGoProvider(true, (async () => new Response("", { status: 202 })) as typeof fetch);
    await expect(p.search("x")).rejects.toThrow(/rate-limiting/);
  });
  it("is used automatically with no keys, after any keyed provider, and can be switched off", () => {
    expect(getProviderChain({} as unknown as unknown as NodeJS.ProcessEnv).map((p) => p.name)).toEqual(["duckduckgo"]);
    expect(getProviderChain({ TAVILY_API_KEY: "t" } as unknown as unknown as NodeJS.ProcessEnv).map((p) => p.name)).toEqual(["tavily", "duckduckgo"]);
    expect(getProviderChain({ KEYLESS_SEARCH: "off" } as unknown as unknown as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe("auditing with no search at all", () => {
  it("audits a directory NGO straight from the website on its record, even when search is off", async () => {
    const store = new MemoryResearchStore();
    const HOST = "https://www.ashakiranfoundation.org";
    const pages: Record<string, string> = { [canonicalUrl(`${HOST}/`)]: HOME_RICH, "/donate": DONATE_PAGE };
    const fetcher = {
      async get(url: string) { const body = pages[canonicalUrl(url)] ?? pages[new URL(url).pathname]; return { requestedUrl: url, finalUrl: url, status: body ? ("OK" as const) : ("FAILED" as const), httpStatus: body ? 200 : 404, contentType: "text/html", body, headers: {}, redirects: [] as string[], ms: 30 }; },
      async robotsInfo() { return { found: false, sitemaps: [] as string[], blockedReason: undefined }; },
    };
    const search = { isConfigured: false, async search(query: string) { return { query, provider: null, results: [], ok: false, errors: [{ provider: "none", message: "off" }] }; } };
    const deps = { store, search, fetcher, catalogue: referenceCatalogue(), ai: null, now: () => new Date("2026-10-21T08:00:00Z") };
    const { created } = await store.upsertEntries([{ name: "Asha Kiran Foundation", city: "Hyderabad", website: HOST, source: "IMPORT" }], "me");
    const { jobId } = await startResearch(deps, { ngoId: created[0].id });
    let job = await store.getJob(jobId);
    for (let i = 0; i < 200 && job && ["QUEUED", "RUNNING"].includes(job.status); i++) { await new Promise((r) => setTimeout(r, 25)); job = await store.getJob(jobId); }
    expect(["COMPLETED", "PARTIAL"]).toContain(job?.status);
    expect((await store.getRecord(created[0].id))?.audited).toBe(true);
  });
});

describe("TinyFish search provider", () => {
  it("calls the documented endpoint with X-API-Key, India/English, and maps results", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string> };
      return new Response(JSON.stringify({ query: "q", total_results: 3, page: 0, results: [
        { position: 1, site_name: "Youth4Jobs", title: "Youth4Jobs – skilling youth with disabilities", snippet: "Hyderabad-based…", url: "https://youth4jobs.org/" },
        { position: 2, title: "Bad", url: "javascript:alert(1)" },
        { position: 3, site_name: "LinkedIn", title: "", snippet: "", url: "https://www.linkedin.com/company/youth4jobs", date: "2026-01-02" },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const { TinyFishProvider } = await import("@/lib/search/tinyfish");
    const r = await new TinyFishProvider("sk-test", fake, 0).search("Youth4Jobs Hyderabad", { includeDomains: ["youth4jobs.org"] });
    const u = new URL(seen!.url);
    expect(u.origin).toBe("https://api.search.tinyfish.ai");
    expect(u.searchParams.get("query")).toBe("Youth4Jobs Hyderabad");
    expect(u.searchParams.get("location")).toBe("IN");
    expect(u.searchParams.get("include_domains")).toBe("youth4jobs.org");
    expect(seen!.headers["x-api-key"]).toBe("sk-test");
    expect(r.map((x) => x.url)).toEqual(["https://youth4jobs.org/", "https://www.linkedin.com/company/youth4jobs"]);
    expect(r[1].title).toBe("LinkedIn");
    expect(r[0].provider).toBe("tinyfish");
  });
  it("reports a clear error on 401 / 402 without retrying forever", async () => {
    const { TinyFishProvider } = await import("@/lib/search/tinyfish");
    const fake = (async () => new Response('{"error":"FREE_ALLOWANCE_EXHAUSTED"}', { status: 402 })) as unknown as typeof fetch;
    await expect(new TinyFishProvider("k", fake, 0).search("x")).rejects.toThrow(/402/);
  });
  it("is used for full-depth search when TINYFISH_API_KEY is set, with the keyless fallback after it", () => {
    expect(getProviderChain({ TINYFISH_API_KEY: "sk" } as unknown as NodeJS.ProcessEnv).map((p) => p.name)).toEqual(["tinyfish", "duckduckgo"]);
    expect(getProviderChain({ SEARCH_PROVIDER: "tinyfish", TINYFISH_API_KEY: "sk", TAVILY_API_KEY: "t" } as unknown as NodeJS.ProcessEnv).map((p) => p.name)).toEqual(["tinyfish", "tavily", "duckduckgo"]);
  });
});
