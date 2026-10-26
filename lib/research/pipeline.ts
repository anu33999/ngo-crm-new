import type { AiClient } from "@/lib/ai/anthropic";
import { sanitizeUntrusted } from "@/lib/ai/untrusted";
import type { Catalogue } from "@/lib/catalogue";
import { buildPricingSection } from "@/lib/pricing/policy";
import { buildPitchFacts } from "@/lib/pitch/facts";
import { generatePitch } from "@/lib/pitch/generate";
import type { Sender } from "@/lib/pitch/types";
import { canonicalUrl, classifyUrl, registrableDomain } from "@/lib/search/normalize";
import type { SearchOutcome, SearchResult } from "@/lib/search/types";
import { auditSite, type FetchedPage, type FetchSummary, type PageRole, type SiteSnapshot } from "./audit";
import { assessCompliance } from "./compliance";
import { discoverSocial, searchPresenceFindings, socialFindings } from "./discover";
import { extractPage, type LinkClass, type PageFacts } from "./extract";
import type { Fetcher, FetchOutcome } from "./fetcher";
import { assessAreas, rankOpportunities } from "./gaps";
import { buildCandidates, resolveIdentity, type Candidate } from "./identity";
import { matchServices } from "./match";
import type { PageSpeedFn } from "./pagespeed";
import { opportunityScore, readinessScores } from "./scoring";
import { STAGES, type JobRecord, type ResearchResult, type ResearchStore, type StageId, type StageLogEntry } from "./store";
import { containsAllTokens } from "./text";
import { buildPitchSummary, darpanStatusOf, pickContact, websiteStatusOf } from "@/lib/crm/summary";
import type { CoverageEntry, CoverageReport, EvidenceDraft, FetchStatus, FindingDraft, SocialDraft } from "./types";

export interface SearchLike {
  isConfigured: boolean;
  search(query: string, opts?: { maxResults?: number; signal?: AbortSignal }): Promise<SearchOutcome>;
}

export interface PipelineDeps {
  store: ResearchStore;
  search: SearchLike;
  fetcher: Pick<Fetcher, "get" | "robotsInfo">;
  catalogue: Catalogue;
  ai?: AiClient | null;
  pagespeed?: PageSpeedFn;
  sender?: Sender;
  now?: () => Date;
  /** How long cached search results stay valid. */
  searchCacheMs?: number;
}

export class JobCancelled extends Error {
  constructor() { super("Job cancelled"); }
}

const PAGE_ROLES: PageRole[] = ["donate", "volunteer", "contact", "about", "reports", "impact", "csr", "media", "events", "privacy"];
const MAX_PAGES = 10;
const DAY = 24 * 3600 * 1000;

const FETCH_STATUS: Record<FetchOutcome["status"], FetchStatus> = {
  OK: "OK", FAILED: "FAILED", BLOCKED_BY_ROBOTS: "BLOCKED_BY_ROBOTS", REQUIRES_LOGIN: "REQUIRES_LOGIN", TIMEOUT: "TIMEOUT", UNSAFE_URL: "FAILED",
};

const summarize = (o: FetchOutcome): FetchSummary => ({ status: o.status, httpStatus: o.httpStatus, ms: o.ms, error: o.error, finalUrl: o.finalUrl });

class Coverage {
  private cats = new Map<string, CoverageEntry>();
  failures: CoverageReport["failures"] = [];
  limitations: string[] = [];
  entry(category: string): CoverageEntry {
    let e = this.cats.get(category);
    if (!e) { e = { category, attempted: 0, succeeded: 0, failed: 0, notes: [] }; this.cats.set(category, e); }
    return e;
  }
  record(category: string, ok: boolean, note?: string, failure?: { url: string; status: string; reason?: string }) {
    const e = this.entry(category);
    e.attempted++;
    if (ok) e.succeeded++; else e.failed++;
    if (note && !e.notes.includes(note)) e.notes.push(note);
    if (failure) this.failures.push(failure);
  }
  note(category: string, note: string) { const e = this.entry(category); if (!e.notes.includes(note)) e.notes.push(note); }
  limit(text: string) { if (!this.limitations.includes(text)) this.limitations.push(text); }
  report(checkedAt: string, evidence: EvidenceDraft[]): CoverageReport {
    return {
      checkedAt,
      categories: [...this.cats.values()],
      pagesReviewed: evidence.filter((e) => e.fetchStatus === "OK").length,
      officialSources: evidence.filter((e) => e.isOfficial).length,
      thirdPartySources: evidence.filter((e) => !e.isOfficial).length,
      failures: this.failures,
      limitations: this.limitations,
    };
  }
}

const STANDING_LIMITATIONS = [
  "Social platforms restrict automated access, so profile existence is taken from the NGO's own website links and search results; follower counts, posting frequency and content quality were not assessed.",
  "Official registries (NGO Darpan, Income Tax, FCRA, MCA CSR) are interactive or captcha-protected and were not queried automatically; each compliance item carries the portal link for manual verification.",
  "Third-party pages (news, directories, reports) were read from search-result titles and snippets only, not fetched in full.",
  "Mobile rendering, payment flows and form submissions were not exercised.",
  "Brand quality, offline activity, staff capability and internal systems cannot be judged from public web data and are reported as “unable to assess”.",
];

export async function runPipeline(jobId: string, deps: PipelineDeps, signal?: AbortSignal): Promise<JobRecord> {
  const { store } = deps;
  const now = () => (deps.now ?? (() => new Date()))().toISOString();
  const cacheMs = deps.searchCacheMs ?? DAY;
  const job0 = await store.getJob(jobId);
  if (!job0) throw new Error(`job ${jobId} not found`);

  const cov = new Coverage();
  STANDING_LIMITATIONS.forEach((l) => cov.limit(l));
  const log: StageLogEntry[] = [...job0.stageLog];
  const failedStages: StageId[] = [];
  const allResults: SearchResult[] = [];
  let lastProvider: string | undefined;
  let searchProviderErrors = 0;
  let usedKeyless = false; // set when any result came from the keyless DuckDuckGo fallback

  const checkCancel = async () => {
    if (signal?.aborted) throw new JobCancelled();
    const cur = await store.getJob(jobId);
    if (cur?.status === "CANCELLED") throw new JobCancelled();
  };

  const stage = async <T>(id: StageId, fn: () => Promise<T>, opts: { critical?: boolean } = {}): Promise<T | undefined> => {
    await checkCancel();
    const meta = STAGES.find((s) => s.id === id) as (typeof STAGES)[number];
    log.push({ stage: id, status: "started", at: now() });
    await store.updateJob(jobId, { status: "RUNNING", stage: id, progress: Math.max(1, meta.progress - 10), stageLog: [...log] });
    try {
      const out = await fn();
      log.push({ stage: id, status: "done", at: now() });
      await store.updateJob(jobId, { progress: meta.progress, stageLog: [...log] });
      return out;
    } catch (e) {
      if (e instanceof JobCancelled || signal?.aborted) throw new JobCancelled();
      const msg = e instanceof Error ? e.message : String(e);
      log.push({ stage: id, status: "failed", at: now(), note: msg.slice(0, 300) });
      failedStages.push(id);
      await store.updateJob(jobId, { stageLog: [...log] });
      if (opts.critical) throw e;
      return undefined;
    }
  };

  const runSearch = async (query: string, category: string): Promise<SearchResult[]> => {
    await checkCancel();
    const cached = await store.getCachedSearch(query, cacheMs);
    if (cached) {
      cov.record(category, true, "Some results were reused from a recent identical search.");
      lastProvider = cached.provider;
      if (cached.provider === "duckduckgo") usedKeyless = true;
      allResults.push(...cached.results);
      return cached.results;
    }
    const out = await deps.search.search(query, { maxResults: 10, signal });
    await store.recordSearch(jobId, { provider: out.provider ?? "none", query, ok: out.ok, error: out.errors.map((e) => `${e.provider}: ${e.message}`).join("; ") || undefined, results: out.results });
    if (out.ok) {
      lastProvider = out.provider ?? lastProvider;
      if (out.provider === "duckduckgo") usedKeyless = true;
      cov.record(category, true);
      allResults.push(...out.results);
    } else {
      searchProviderErrors++;
      cov.record(category, false, "A search query failed; coverage for this category may be incomplete.", { url: `search: ${query}`, status: "SEARCH_FAILED", reason: out.errors.map((e) => `${e.provider}: ${e.message}`).join("; ").slice(0, 200) });
    }
    return out.results;
  };

  try {
    await store.updateJob(jobId, { status: "RUNNING", startedAt: job0.startedAt ?? now(), error: null });
    const name = job0.queryName;
    const location = job0.queryLocation ?? undefined;
    const evidence = new Map<string, EvidenceDraft>();
    const addEvidence = (e: EvidenceDraft) => { const k = canonicalUrl(e.url); if (!evidence.has(k) || e.fetchStatus === "OK") evidence.set(k, e); };

    // ── 1. identity resolution ───────────────────────────────────────────────
    let chosen: Candidate | undefined;
    let identityStatus: ResearchResult["identityStatus"] = "UNVERIFIED";
    let brandResults: SearchResult[] = [];
    let needsConfirmation = false;
    const ok1 = await stage("identify", async () => {
      const state = job0.candidates;
      // With a website already chosen by a person (or on the directory record), no search is needed to know who this is.
      const knownSite = !!state.selectedKey && state.options.some((c) => c.key === state.selectedKey);
      if (!deps.search.isConfigured && !knownSite) {
        throw new Error("Search is turned off (KEYLESS_SEARCH=off and no search key), and this NGO has no website on record. Add its website in the Details panel, or turn search back on, then retry.");
      }
      let options = state.options;
      const queries = [`${name} ${location ?? ""}`.trim(), `${name} NGO India official website`, `${name} foundation trust registered ${location ?? ""}`.trim()];
      // The plain brand query always runs (cached on resume) so brand-search visibility can be assessed.
      brandResults = deps.search.isConfigured ? await runSearch(queries[0], "Identity search") : [];
      if (!options.length) {
        const others = await Promise.all(queries.slice(1).map((q) => runSearch(q, "Identity search")));
        const results = [...brandResults, ...others.flat()];
        if (!results.length) throw new Error(searchProviderErrors ? "Every identity search failed (the search service may be rate-limiting). Wait a few minutes and retry — or add the NGO's website in the Details panel so the audit can go straight to it." : `No search results were returned for “${name}”.`);
        options = buildCandidates({ name, location }, results);
      }
      if (state.selectedKey) {
        chosen = options.find((c) => c.key === state.selectedKey);
        if (!chosen) throw new Error("The selected organisation is no longer in the candidate list; start the search again.");
        identityStatus = "CONFIRMED";
        return;
      }
      const res = resolveIdentity(options);
      if (res.status === "resolved") {
        chosen = res.candidate;
        needsConfirmation = res.needsConfirmation;
        return;
      }
      if (!res.candidates.length) throw new Error(`No organisation matching “${name}” could be identified from the search results.`);
      // A person must choose.
      await store.updateJob(jobId, { status: "AWAITING_DISAMBIGUATION", candidates: { options: res.candidates }, stage: "identify", progress: 10, stageLog: [...log] });
    }, { critical: true });
    void ok1;
    const afterIdentify = await store.getJob(jobId);
    if (afterIdentify?.status === "AWAITING_DISAMBIGUATION") return afterIdentify;
    if (!chosen) throw new Error("Identity could not be resolved.");
    const identity: Candidate = chosen;
    const officialName = identity.directoryOnly ? identity.name : identity.name.replace(/\s*[|–—-]\s*.*$/, "").trim() || identity.name;

    // ── 2. official site + social discovery ──────────────────────────────────
    let homeOutcome: FetchOutcome | null = null;
    let homeFacts: PageFacts | null = null;
    let social: SocialDraft[] = [];
    const siteUrl = identity.website ?? null;
    const officialDomain = identity.domain ?? (siteUrl ? registrableDomain(siteUrl) : null);
    await stage("discover", async () => {
      if (siteUrl) {
        homeOutcome = await deps.fetcher.get(siteUrl, signal);
        const ok = homeOutcome.status === "OK" && !!homeOutcome.body;
        cov.record("Official website", ok, undefined, ok ? undefined : { url: siteUrl, status: homeOutcome.status, reason: homeOutcome.error });
        addEvidence({
          url: siteUrl, title: undefined, sourceType: "OFFICIAL_WEBSITE", isOfficial: true, fetchStatus: FETCH_STATUS[homeOutcome.status], httpStatus: homeOutcome.httpStatus,
          failureReason: ok ? undefined : homeOutcome.error, confidence: "HIGH", checkedAt: now(),
        });
        if (ok && homeOutcome.body) {
          homeFacts = extractPage(homeOutcome.body, homeOutcome.finalUrl ?? siteUrl);
          const e = evidence.get(canonicalUrl(siteUrl)) as EvidenceDraft;
          e.title = sanitizeUntrusted(homeFacts.title, 160).text || undefined;
          e.snapshot = sanitizeUntrusted(homeFacts.textSample, 500).text || undefined;
          e.summary = sanitizeUntrusted(homeFacts.metaDescription, 240).text || undefined;
        }
      } else {
        cov.note("Official website", "No official website was identified, so the website audit was not performed.");
      }
      const socialResults = await runSearch(`${officialName} Instagram Facebook LinkedIn YouTube official`, "Social profiles");
      social = discoverSocial({ ngoName: officialName, siteFacts: homeFacts ? [homeFacts] : [], results: socialResults });
      for (const p of social.filter((s) => s.url)) {
        addEvidence({ url: p.url as string, sourceType: "OFFICIAL_SOCIAL", isOfficial: p.isOfficial, fetchStatus: "NOT_ATTEMPTED", failureReason: "The platform restricts automated access; the profile page was not fetched.", summary: p.basis, confidence: p.isOfficial ? "MEDIUM" : "LOW", checkedAt: now() });
      }
      cov.note("Social profiles", `${social.filter((s) => s.url).length} of ${social.length} platforms located.`);
    });

    // ── 3. reports, news, compliance ─────────────────────────────────────────
    let compliance = assessCompliance({ ngoName: officialName, results: allResults, siteFacts: homeFacts ? [homeFacts] : [], siteUrl: siteUrl ?? undefined });
    await stage("public-sources", async () => {
      await Promise.all([
        runSearch(`${officialName} annual report impact report`, "Reports and news"),
        runSearch(`${officialName} news`, "Reports and news"),
        runSearch(`${officialName} 80G 12A FCRA registration`, "Compliance signals"),
      ]);
      for (const r of allResults) {
        const kind = classifyUrl(r.url, r.title);
        if (!["GOVERNMENT_REGISTRY", "DIRECTORY", "NEWS", "ANNUAL_REPORT"].includes(kind)) continue;
        if (!containsAllTokens(`${r.title} ${r.snippet}`, officialName)) continue;
        const sourceType = kind === "GOVERNMENT_REGISTRY" ? "GOVERNMENT_REGISTRY" : kind === "DIRECTORY" ? "DIRECTORY" : kind === "NEWS" ? "NEWS" : "ANNUAL_REPORT";
        addEvidence({
          url: r.url, title: sanitizeUntrusted(r.title, 160).text, sourceType, isOfficial: !!officialDomain && registrableDomain(r.url) === officialDomain,
          fetchStatus: "NOT_ATTEMPTED", summary: sanitizeUntrusted(r.snippet, 300).text, snapshot: sanitizeUntrusted(r.snippet, 300).text,
          confidence: kind === "GOVERNMENT_REGISTRY" ? "HIGH" : kind === "DIRECTORY" ? "LOW" : "MEDIUM", publishedAt: r.publishedAt, checkedAt: now(),
        });
      }
      compliance = assessCompliance({ ngoName: officialName, results: allResults, siteFacts: homeFacts ? [homeFacts] : [], siteUrl: siteUrl ?? undefined });
    });

    // ── 4. technical website audit ───────────────────────────────────────────
    const pages: FetchedPage[] = [];
    let snapshot: SiteSnapshot | null = null;
    let auditFindings: FindingDraft[] = [];
    await stage("audit", async () => {
      const home = homeFacts as PageFacts | null;
      const base = siteUrl ?? "";
      if (siteUrl && home) {
        // pick the first internal link for each page role, fetch each URL once
        const planned = new Map<string, PageRole[]>();
        for (const role of PAGE_ROLES) {
          const links = home.keywordLinks[role as LinkClass] ?? [];
          for (const l of links) {
            let u: URL;
            try { u = new URL(l.href, home.url); } catch { continue; }
            if (!/^https?:$/.test(u.protocol) || registrableDomain(u.hostname) !== registrableDomain(home.url)) continue;
            u.hash = "";
            const key = u.toString();
            if (canonicalUrl(key) === canonicalUrl(home.url)) continue;
            planned.set(key, [...(planned.get(key) ?? []), role]);
            break;
          }
        }
        const targets = [...planned.entries()].slice(0, MAX_PAGES);
        const fetched = new Map<string, FetchOutcome>();
        for (const [url] of targets) {
          await checkCancel();
          const out = await deps.fetcher.get(url, signal);
          fetched.set(url, out);
          const ok = out.status === "OK";
          cov.record("Key pages", ok, undefined, ok ? undefined : { url, status: out.status, reason: out.error });
        }
        for (const [url, roles] of targets) {
          const out = fetched.get(url) as FetchOutcome;
          const facts = out.status === "OK" && out.body && /html|xml/i.test(out.contentType ?? "html") ? extractPage(out.body, out.finalUrl ?? url) : undefined;
          for (const role of roles) pages.push({ role, url, linkedFrom: home.url, fetch: summarize(out), facts });
          addEvidence({
            url, title: facts ? sanitizeUntrusted(facts.title, 160).text || undefined : undefined, sourceType: "OFFICIAL_WEBSITE", isOfficial: true, fetchStatus: FETCH_STATUS[out.status], httpStatus: out.httpStatus,
            failureReason: out.status === "OK" ? undefined : out.error, snapshot: facts ? sanitizeUntrusted(facts.textSample, 500).text || undefined : undefined, confidence: "HIGH", checkedAt: now(),
          });
        }
        const origin = new URL(siteUrl).origin;
        const robots = await deps.fetcher.robotsInfo(origin, signal);
        let sitemap: SiteSnapshot["sitemap"] = null;
        const sitemapUrl = robots.sitemaps[0] ?? `${origin}/sitemap.xml`;
        const sm = await deps.fetcher.get(sitemapUrl, signal);
        if (sm.status === "OK" && sm.body && /<(urlset|sitemapindex)/i.test(sm.body)) {
          sitemap = { url: sitemapUrl, found: true, urlCount: (sm.body.match(/<loc>/gi) ?? []).length };
          addEvidence({ url: sitemapUrl, sourceType: "OFFICIAL_WEBSITE", isOfficial: true, fetchStatus: "OK", httpStatus: sm.httpStatus, confidence: "HIGH", checkedAt: now() });
        } else sitemap = { url: sitemapUrl, found: false };
        cov.record("Sitemap and robots.txt", true);

        const ps = await (deps.pagespeed ?? (async () => ({ unavailable: "No PageSpeed provider configured." })))(siteUrl, signal);
        cov.record("Performance (PageSpeed Insights)", !("unavailable" in ps), "unavailable" in ps ? ps.unavailable : undefined);
        if (!("unavailable" in ps)) addEvidence({ url: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(siteUrl)}`, title: "PageSpeed Insights (mobile)", sourceType: "AUDIT_TOOL", isOfficial: false, fetchStatus: "OK", summary: `Mobile performance score ${ps.performance}/100`, confidence: "MEDIUM", checkedAt: now() });
        snapshot = { siteUrl, checkedAt: now(), homepage: summarize(homeOutcome as unknown as FetchOutcome), homeFacts: home, pages, robots: { found: robots.found, sitemaps: robots.sitemaps, blockedReason: robots.blockedReason }, sitemap, pagespeed: ps };
      } else {
        snapshot = {
          siteUrl: base || "(no website identified)", checkedAt: now(), homepage: homeOutcome ? summarize(homeOutcome) : { status: "FAILED", error: "No official website was identified." }, homeFacts: null, pages: [],
          robots: { found: false, sitemaps: [] }, sitemap: null, pagespeed: { unavailable: "No website to measure." },
        };
      }
      auditFindings = siteUrl ? auditSite(snapshot) : [];
      // compliance claims may appear on inner pages (about / reports)
      const factsAll = [homeFacts, ...pages.map((p) => p.facts)].filter((f): f is PageFacts => !!f);
      compliance = assessCompliance({ ngoName: officialName, results: allResults, siteFacts: factsAll, siteUrl: siteUrl ?? undefined });
    });

    // ── 5. evidence normalisation + gap extraction ───────────────────────────
    const siteAssessable = !!homeFacts;
    const findings: FindingDraft[] = [
      ...auditFindings,
      ...socialFindings(social, siteAssessable, now()),
      ...searchPresenceFindings({ ngoName: officialName, officialDomain: officialDomain ?? undefined, provider: lastProvider, results: brandResults.slice(0, 10), checkedAt: now() }),
    ];
    // every finding's evidence must resolve to a stored source
    const resultByUrl = new Map(allResults.map((r) => [canonicalUrl(r.url), r]));
    for (const f of findings) {
      f.evidenceUrls = [...new Set(f.evidenceUrls.map((u) => {
        const k = canonicalUrl(u);
        if (!evidence.has(k)) {
          const r = resultByUrl.get(k);
          if (!r) return null;
          addEvidence({ url: r.url, title: sanitizeUntrusted(r.title, 160).text, sourceType: "SEARCH_RESULT", isOfficial: !!officialDomain && registrableDomain(r.url) === officialDomain, fetchStatus: "NOT_ATTEMPTED", summary: sanitizeUntrusted(r.snippet, 300).text, confidence: "MEDIUM", checkedAt: now() });
        }
        return (evidence.get(k) as EvidenceDraft).url;
      }).filter((u): u is string => !!u))];
    }
    type Areas = ReturnType<typeof assessAreas>;
    let areas: Areas = [];
    let top: ReturnType<typeof rankOpportunities> = [];
    await stage("opportunities", async () => {
      areas = assessAreas(findings, { checkedAt: now(), siteAssessable, https: !!snapshot?.homepage.finalUrl?.startsWith("https://") || !!siteUrl?.startsWith("https://"), hasAboutContent: pages.some((p) => p.role === "about" && p.fetch.status === "OK"), officialSiteUrl: siteUrl ?? undefined });
      top = rankOpportunities(areas);
    });
    // area gap findings (merged) are part of the persisted findings
    const areaFindings = areas.map((a) => a.finding).filter((f): f is FindingDraft => !!f && f.section === "GAP" && !findings.some((x) => x.key === f.key));
    const allFindings = [...findings, ...areaFindings];

    // ── 6. catalogue matching ────────────────────────────────────────────────
    let match: ReturnType<typeof matchServices> = { recommendations: [], doNotPitch: [] };
    await stage("match", async () => { match = matchServices({ areas, top, catalogue: deps.catalogue, location }); });

    const readiness = readinessScores(findings);
    const attempted = [...cov.report(now(), []).categories].reduce((s, c) => s + c.attempted, 0);
    const succeeded = [...cov.report(now(), []).categories].reduce((s, c) => s + c.succeeded, 0);
    const opp = opportunityScore({ areas, top, recommendations: match.recommendations, siteAssessable, socialLocated: social.filter((s) => s.url).length, identityConfidence: identity.score, evidenceCoverage: attempted ? succeeded / attempted : 0 });

    const policy = await store.getActivePolicy();
    const pricing = buildPricingSection({ policy, recommendations: match.recommendations, catalogue: deps.catalogue });
    const evidenceList = [...evidence.values()];
    const coverage = cov.report(now(), evidenceList);
    if (usedKeyless) coverage.limitations.unshift("REDUCED RESEARCH: no search API key is set, so searches used the keyless DuckDuckGo fallback (fewer results per query, rate-limited). Identity, social and third-party coverage may be thinner than a full audit. Add TINYFISH_API_KEY (or TAVILY_API_KEY) to .env and use “Refresh intelligence” for full depth.");
    if (!deps.ai) coverage.limitations.push("No ANTHROPIC_API_KEY configured: outreach drafts were composed deterministically from the evidence rather than polished by a language model.");

    const result: ResearchResult = {
      ngoName: name, officialName, location, identityStatus: needsConfirmation ? "UNVERIFIED" : identityStatus, matchSignals: identity.signals, officialSite: siteUrl, officialDomain,
      identityConfidence: identity.score, social, compliance, evidence: evidenceList, findings: allFindings, recommendations: [...match.recommendations],
      analysis: {
        readiness, opportunity: opp,
        areas: areas.map((a) => ({ areaId: a.area.id, gapState: a.gapState, assessment: a.assessment, findingKey: a.finding?.key ?? null })),
        top: top.map((t) => ({ areaId: t.areaId, score: t.score })),
        doNotPitch: match.doNotPitch,
      },
      coverage, pitch: null, pitchPolicyId: null,
      crm: {
        websiteStatus: websiteStatusOf({ officialSite: siteUrl }, siteAssessable),
        darpanStatus: darpanStatusOf(compliance),
        pitchSummary: "",
        matchedServiceCodes: [...new Set(match.recommendations.map((x) => x.serviceCode))],
        contact: pickContact([homeFacts as PageFacts | null, ...pages.map((p) => p.facts)].filter((f): f is PageFacts => !!f)),
      },
    };
    if (result.crm) result.crm.pitchSummary = buildPitchSummary(result);

    // ── 7. pitch ─────────────────────────────────────────────────────────────
    await stage("pitch", async () => {
      const facts = buildPitchFacts({
        ngoName: officialName, location, siteUrl: siteUrl ?? undefined, existing: allFindings.filter((f) => f.section === "EXISTING"), top, recommendations: match.recommendations,
        doNotPitch: match.doNotPitch, pricing, sender: deps.sender,
      });
      result.pitch = await generatePitch({ facts, tone: "warm-professional", ai: deps.ai, signal });
      result.pitchPolicyId = policy?.id ?? null;
    });

    await checkCancel();
    const { ngoId } = await store.saveResult(jobId, result);
    if (result.pitch) await store.savePitch(ngoId, jobId, result.pitchPolicyId, result.pitch);

    const degraded = failedStages.length > 0 || !siteAssessable || searchProviderErrors > 0;
    return await store.updateJob(jobId, {
      status: degraded ? "PARTIAL" : "COMPLETED", stage: "pitch", progress: 100, coverage, ngoId, finishedAt: now(), stageLog: [...log],
      error: failedStages.length ? `Stages with errors: ${failedStages.join(", ")}` : null,
    });
  } catch (e) {
    if (e instanceof JobCancelled || signal?.aborted) {
      return await store.updateJob(jobId, { status: "CANCELLED", finishedAt: now(), stageLog: [...log] });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return await store.updateJob(jobId, { status: "FAILED", error: msg.slice(0, 500), finishedAt: now(), stageLog: [...log] });
  }
}
