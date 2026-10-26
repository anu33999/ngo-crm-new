import { describe, expect, it } from "vitest";
import { referenceCatalogue } from "@/lib/catalogue";
import type { FetchOutcome } from "@/lib/research/fetcher";
import { MemoryResearchStore } from "@/lib/research/memory-store";
import type { PipelineDeps, SearchLike } from "@/lib/research/pipeline";
import { runPipeline } from "@/lib/research/pipeline";
import { cancelJob, InputError, launch, retryJob, selectCandidate, startResearch } from "@/lib/research/runner";
import { canonicalUrl } from "@/lib/search/normalize";
import type { SearchResult } from "@/lib/search/types";
import { AMBIGUOUS_RESULTS, CLEAR_RESULTS, NOTHING_RELEVANT } from "./fixtures/search-results";
import { DONATE_PAGE, HOME_INJECTION, HOME_RICH, HOME_SPARSE } from "./fixtures/html";

const HOST = "https://www.ashakiranfoundation.org";

function mockSearch(results: SearchResult[], opts: { configured?: boolean; fail?: boolean } = {}): SearchLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isConfigured: opts.configured ?? true,
    async search(query) {
      calls.push(query);
      if (opts.fail) return { query, provider: null, results: [], ok: false, errors: [{ provider: "tavily", message: "HTTP 401 invalid key" }] };
      return { query, provider: "mock", results, ok: true, errors: [] };
    },
  };
}

type Page = { status?: FetchOutcome["status"]; httpStatus?: number; body?: string; error?: string };
function mockFetcher(pages: Record<string, Page>, hook?: (url: string) => Promise<void> | void) {
  const requested: string[] = [];
  return {
    requested,
    async get(url: string): Promise<FetchOutcome> {
      requested.push(url);
      await hook?.(url);
      const p = pages[canonicalUrl(url)] ?? pages[new URL(url).pathname] ?? { status: "FAILED", httpStatus: 404, error: "HTTP 404" };
      const status = p.status ?? "OK";
      return { requestedUrl: url, finalUrl: url, status, httpStatus: p.httpStatus ?? (status === "OK" ? 200 : undefined), contentType: "text/html", body: p.body, headers: {}, redirects: [], error: p.error, ms: 120 };
    },
    async robotsInfo() { return { found: false, sitemaps: [] as string[], blockedReason: undefined }; },
  };
}

const SITE_PAGES: Record<string, Page> = {
  [canonicalUrl(`${HOST}/`)]: { body: HOME_RICH },
  "/donate": { body: DONATE_PAGE },
  "/about": { body: "<html lang='en'><title>About</title><body><h1>About us</h1><p>Our board of trustees.</p></body></html>" },
  "/contact": { body: "<html lang='en'><title>Contact</title><body><h1>Contact</h1></body></html>" },
};

function deps(store: MemoryResearchStore, search: SearchLike, fetcher = mockFetcher(SITE_PAGES)): PipelineDeps & { fetcher: ReturnType<typeof mockFetcher> } {
  return { store, search, fetcher, catalogue: referenceCatalogue(), ai: null, now: () => new Date("2026-10-20T10:00:00Z") };
}

describe("research pipeline", () => {
  it("runs all 7 stages, persists findings/evidence/recommendations/pitch and reports coverage", async () => {
    const store = new MemoryResearchStore();
    const d = deps(store, mockSearch(CLEAR_RESULTS));
    const job = await store.createJob({ queryName: "Asha Kiran Foundation", queryLocation: "Hyderabad" });
    const done = await runPipeline(job.id, d);
    expect(["COMPLETED", "PARTIAL"]).toContain(done.status);
    expect(done.stageLog.filter((l) => l.status === "done").map((l) => l.stage)).toEqual(["identify", "discover", "public-sources", "audit", "opportunities", "match", "pitch"]);
    expect(done.progress).toBe(100);
    expect(done.ngoId).toBeTruthy();

    const view = await store.getNgoView(done.ngoId as string);
    expect(view?.analysis?.areas).toHaveLength(22);
    expect(view?.findings.length).toBeGreaterThan(5);
    expect(view?.pitches[0].drafts).toHaveLength(8);
    expect(view?.identity?.officialWebsite).toMatch(/ashakiranfoundation/);
    expect(done.coverage?.categories.map((c) => c.category)).toEqual(expect.arrayContaining(["Identity search", "Official website", "Key pages", "Compliance signals"]));
    expect(done.coverage?.limitations.length).toBeGreaterThan(3);
  });

  it("every citation resolves: each finding's evidence URL exists in the stored evidence list", async () => {
    const store = new MemoryResearchStore();
    const job = await store.createJob({ queryName: "Asha Kiran Foundation", queryLocation: "Hyderabad" });
    const done = await runPipeline(job.id, deps(store, mockSearch(CLEAR_RESULTS)));
    const view = await store.getNgoView(done.ngoId as string);
    const urls = new Set(view?.evidence.map((e) => e.url));
    for (const f of view?.findings ?? []) for (const u of f.evidenceUrls) expect(urls.has(u), `${f.key} -> ${u}`).toBe(true);
    for (const e of view?.evidence ?? []) expect(e.checkedAt).toMatch(/^2026-10-20/);
  });

  it("pauses for a human when the name is ambiguous, then continues after a choice", async () => {
    const store = new MemoryResearchStore();
    const d = deps(store, mockSearch(AMBIGUOUS_RESULTS), mockFetcher({ "/": { body: HOME_SPARSE } }));
    const started = await startResearch(d, { name: "Hope Foundation" });
    const first = await launchDone(store, started.jobId);
    expect(first.status).toBe("AWAITING_DISAMBIGUATION");
    expect(first.candidates.options.length).toBeGreaterThanOrEqual(2);
    expect(first.ngoId).toBeNull();
    expect(d.fetcher.requested).toHaveLength(0); // nothing was fetched before a person chose

    await expect(selectCandidate(d, started.jobId, { key: "not-a-candidate" })).rejects.toThrow(InputError);
    const key = first.candidates.options[0].key;
    const resumed = selectCandidate(d, started.jobId, { key });
    await resumed;
    const finished = await waitFor(store, started.jobId, (j) => ["COMPLETED", "PARTIAL", "FAILED"].includes(j.status));
    expect(["COMPLETED", "PARTIAL"]).toContain(finished.status);
    const view = await store.getNgoView(finished.ngoId as string);
    expect(view?.ngo.identityStatus).toBe("CONFIRMED");
  });

  it("accepts an official website supplied by a person when nothing matches", async () => {
    const store = new MemoryResearchStore();
    const d = deps(store, mockSearch(NOTHING_RELEVANT), mockFetcher({ "/": { body: HOME_SPARSE } }));
    const started = await startResearch(d, { name: "Hope Foundation" });
    const first = await launchDone(store, started.jobId);
    expect(["AWAITING_DISAMBIGUATION", "FAILED"]).toContain(first.status);
    if (first.status === "AWAITING_DISAMBIGUATION") {
      await selectCandidate(d, started.jobId, { website: "hopefoundation.example.in" });
      const done = await waitFor(store, started.jobId, (j) => ["COMPLETED", "PARTIAL", "FAILED"].includes(j.status));
      expect(d.fetcher.requested[0]).toMatch(/^https:\/\/hopefoundation\.example\.in/);
      expect(["COMPLETED", "PARTIAL"]).toContain(done.status);
    }
  });

  it("a failing homepage does not crash the run: result is PARTIAL with 'unable to assess', not invented gaps", async () => {
    const store = new MemoryResearchStore();
    const d = deps(store, mockSearch(CLEAR_RESULTS), mockFetcher({ "/": { status: "TIMEOUT", error: "timed out after 15000ms" } }));
    const job = await store.createJob({ queryName: "Asha Kiran Foundation", queryLocation: "Hyderabad" });
    const done = await runPipeline(job.id, d);
    expect(done.status).toBe("PARTIAL");
    expect(done.coverage?.failures.some((f) => f.status === "TIMEOUT")).toBe(true);
    const view = await store.getNgoView(done.ngoId as string);
    const reach = view?.findings.find((f) => f.key === "site.reachable");
    expect(reach?.gapState).toBe("UNABLE_TO_ASSESS");
    expect(view?.findings.some((f) => f.gapState === "CONFIRMED_ISSUE" && /donat/i.test(f.title))).toBe(false);
  });

  it("respects robots.txt: a blocked site is reported as unable to assess, never audited", async () => {
    const store = new MemoryResearchStore();
    const d = deps(store, mockSearch(CLEAR_RESULTS), mockFetcher({ "/": { status: "BLOCKED_BY_ROBOTS", error: "disallowed by robots.txt" } }));
    const job = await store.createJob({ queryName: "Asha Kiran Foundation", queryLocation: "Hyderabad" });
    const done = await runPipeline(job.id, d);
    const view = await store.getNgoView(done.ngoId as string);
    expect(view?.findings.find((f) => f.key === "site.reachable")?.observation).toMatch(/robots\.txt/);
    expect(d.fetcher.requested.filter((u) => /\/donate|\/about/.test(u))).toHaveLength(0);
  });

  it("fails clearly when no search provider is configured, and when every search fails", async () => {
    const store = new MemoryResearchStore();
    const a = await store.createJob({ queryName: "Asha Kiran Foundation" });
    const none = await runPipeline(a.id, deps(store, mockSearch([], { configured: false })));
    expect(none.status).toBe("FAILED");
    expect(none.error).toMatch(/Search is turned off/);

    const b = await store.createJob({ queryName: "Asha Kiran Foundation" });
    const failed = await runPipeline(b.id, deps(store, mockSearch([], { fail: true })));
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toMatch(/Every identity search failed/);
  });

  it("can be cancelled mid-run and saves nothing", async () => {
    const store = new MemoryResearchStore();
    const ctrl = new AbortController();
    const d = deps(store, mockSearch(CLEAR_RESULTS), mockFetcher(SITE_PAGES, async () => { ctrl.abort(); }));
    const job = await store.createJob({ queryName: "Asha Kiran Foundation", queryLocation: "Hyderabad" });
    const done = await runPipeline(job.id, d, ctrl.signal);
    expect(done.status).toBe("CANCELLED");
    expect(store.ngos.size).toBe(0);
  });

  it("cancelJob works through the store even when the pipeline is on another instance", async () => {
    const store = new MemoryResearchStore();
    const d = deps(store, mockSearch(CLEAR_RESULTS));
    const job = await store.createJob({ queryName: "Asha Kiran Foundation" });
    await store.updateJob(job.id, { status: "RUNNING" });
    expect((await cancelJob(d, job.id)).status).toBe("CANCELLED");
    const after = await runPipeline(job.id, d); // a late-starting pipeline must see the cancellation
    expect(after.status).toBe("CANCELLED");
    expect(store.ngos.size).toBe(0);
  });

  it("reuses cached searches on retry and returns a cached job for an identical recent query", async () => {
    const store = new MemoryResearchStore();
    const search = mockSearch(CLEAR_RESULTS);
    const d = deps(store, search);
    const first = await store.createJob({ queryName: "Asha Kiran Foundation", queryLocation: "Hyderabad" });
    await runPipeline(first.id, d);
    const callsAfterFirst = search.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(3);

    const retry = await retryJob(d, first.id);
    await waitFor(store, retry.jobId, (j) => ["COMPLETED", "PARTIAL", "FAILED"].includes(j.status));
    expect(search.calls.length).toBe(callsAfterFirst); // every query came from the cache
    const retried = await store.getJob(retry.jobId);
    expect(retried?.attempt).toBe(2);
    expect(retried?.parentJobId).toBe(first.id);

    const again = await startResearch(d, { name: "  asha kiran foundation ", location: "Hyderabad" });
    expect(again.cached).toBe(true);
    const fresh = await startResearch(d, { name: "Asha Kiran Foundation", location: "Hyderabad", refresh: true });
    expect(fresh.cached).toBe(false);
    await waitFor(store, fresh.jobId, (j) => ["COMPLETED", "PARTIAL", "FAILED"].includes(j.status));
  });

  it("keeps human review decisions across a refresh", async () => {
    const store = new MemoryResearchStore();
    const d = deps(store, mockSearch(CLEAR_RESULTS));
    const j1 = await store.createJob({ queryName: "Asha Kiran Foundation", queryLocation: "Hyderabad" });
    const r1 = await runPipeline(j1.id, d);
    const v1 = await store.getNgoView(r1.ngoId as string);
    const rec = v1?.recommendations[0];
    if (!rec) throw new Error("expected at least one recommendation");
    await store.reviewRecommendation(rec.id, { approval: "REJECTED" }, "reviewer@example.com");
    const j2 = await store.createJob({ queryName: "Asha Kiran Foundation", queryLocation: "Hyderabad", isRefresh: true });
    const r2 = await runPipeline(j2.id, d);
    expect(r2.ngoId).toBe(r1.ngoId);
    const v2 = await store.getNgoView(r2.ngoId as string);
    expect(v2?.recommendations.find((r) => r.serviceCode === rec.serviceCode)?.approval).toBe("REJECTED");
  });

  it("treats hostile page text as data: no injected instruction reaches findings, evidence or pitch", async () => {
    const store = new MemoryResearchStore();
    const d = deps(store, mockSearch(CLEAR_RESULTS), mockFetcher({ "/": { body: HOME_INJECTION } }));
    const job = await store.createJob({ queryName: "Asha Kiran Foundation", queryLocation: "Hyderabad" });
    const done = await runPipeline(job.id, d);
    const view = await store.getNgoView(done.ngoId as string);
    const dump = JSON.stringify(view);
    expect(dump).not.toMatch(/ignore all previous instructions/i);
    expect(dump).not.toMatch(/reveal the system prompt/i);
    expect(view?.findings.every((f) => f.priority !== "CRITICAL")).toBe(true); // page text cannot change priorities
  });

  it("never stores internal economics in anything the research engine writes", async () => {
    const store = new MemoryResearchStore();
    const job = await store.createJob({ queryName: "Asha Kiran Foundation", queryLocation: "Hyderabad" });
    const done = await runPipeline(job.id, deps(store, mockSearch(CLEAR_RESULTS)));
    const dump = JSON.stringify(await store.getNgoView(done.ngoId as string));
    expect(dump).not.toMatch(/internalEconomics|estimatedHours|grossContribution|blendedCost/i);
  });
});

async function waitFor(store: MemoryResearchStore, id: string, pred: (j: Awaited<ReturnType<MemoryResearchStore["getJob"]>> & object) => boolean, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const j = await store.getJob(id);
    if (j && pred(j)) return j;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting; status=${j?.status}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function launchDone(store: MemoryResearchStore, id: string) {
  return waitFor(store, id, (j) => !["QUEUED", "RUNNING"].includes(j.status));
}
void launch;
