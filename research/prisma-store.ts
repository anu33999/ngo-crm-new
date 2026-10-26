/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PolicyConfig } from "@/lib/pricing/policy";
import type { PitchBundle } from "@/lib/pitch/generate";
import type { Channel, Tone } from "@/lib/pitch/types";
import type { SearchResult } from "@/lib/search/types";
import { db } from "@/lib/db";
import { normalizeName } from "./text";
import type { Candidate } from "./identity";
import type { Recommendation } from "./match";
import type {
  AnalysisSummary, CandidateState, EvidenceView, FindingView, JobPatch, JobRecord, NewJob, NgoView, PitchDraftView, PitchView,
  RecommendationView, ResearchResult, ResearchStore, StageLogEntry,
} from "./store";
import type { ComplianceItem, CoverageReport, EvidenceDraft, SocialDraft } from "./types";
import { referenceCatalogue } from "@/lib/catalogue";
import { changeLines, contactedAtFor, matchesFilter, PROFILE_KEYS, type CrmNoteView, type DarpanStatus, type DirectoryEntry, type NgoFilter, type NgoPatch, type NgoRecord, type Profile, type WebsiteStatus } from "@/lib/crm/types";
import { locationLabel, tidyPlace } from "@/lib/geo/areas";

/**
 * Prisma-backed store (SQLite locally, Postgres in production).
 *
 * NOTE: this file could not be executed in the sandbox it was written in (the Prisma engine download is blocked
 * there). It is written against prisma/schema.prisma and mirrors MemoryResearchStore, which the tests cover.
 * Run `npm run db:setup` and the app locally to exercise it. The Json helpers below intentionally cast so the code
 * compiles both before and after `prisma generate`.
 */

const json = (v: unknown) => v as never;
const asJson = <T>(v: unknown, fallback: T): T => (v === null || v === undefined ? fallback : (v as T));
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const P = () => db() as any;

const COMPLIANCE_COLUMN: Record<ComplianceItem["key"], string> = { "80G": "status80G", "12A": "status12A", FCRA: "statusFCRA", "CSR-1": "statusCSR1", "NGO Darpan": "statusDarpan" };

function toJob(r: any): JobRecord {
  const cand = r.candidates;
  const candidates: CandidateState = Array.isArray(cand) ? { options: cand as Candidate[] } : { options: asJson(cand?.options, [] as Candidate[]), selectedKey: cand?.selectedKey ?? undefined };
  const cov = r.coverage && Object.keys(r.coverage).length ? (r.coverage as CoverageReport) : null;
  return {
    id: r.id, ngoId: r.ngoId ?? null, queryName: r.queryName, queryLocation: r.queryLocation ?? null, status: r.status, stage: r.stage ?? null, progress: r.progress,
    stageLog: asJson<StageLogEntry[]>(r.stageLog, []), candidates, coverage: cov, attempt: r.attempt, isRefresh: r.isRefresh, parentJobId: r.parentJobId ?? null,
    error: r.error ?? null, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt), createdAt: r.createdAt.toISOString(),
  };
}

function toPitchView(p: any): PitchView {
  const sb = (p.scoreBreakdown ?? {}) as { perChannel?: Record<string, any>; warnings?: string[]; generatedBy?: string };
  const drafts: PitchDraftView[] = (p.drafts ?? []).map((d: any) => {
    const meta = sb.perChannel?.[d.channel] ?? {};
    return {
      id: d.id, channel: d.channel as Channel, subject: d.subject ?? null, body: d.body, editedBody: d.editedBody ?? null, status: d.status,
      score: meta.score ?? null, breakdown: meta.breakdown ?? null, origin: meta.origin ?? "deterministic", lint: meta.lint ?? [], notes: meta.notes ?? [],
    };
  });
  const order = ["COLD_EMAIL", "WHATSAPP", "LINKEDIN", "PHONE_SCRIPT", "FOLLOW_UP_EMAIL", "MEETING_REQUEST", "ONE_PAGE_PROPOSAL", "DISCOVERY_QUESTIONS"];
  drafts.sort((a, b) => order.indexOf(a.channel) - order.indexOf(b.channel));
  return { id: p.id, tone: p.tone as Tone, version: p.version, scoreTotal: p.scoreTotal ?? null, status: p.status, generatedBy: sb.generatedBy ?? "deterministic", warnings: sb.warnings ?? [], createdAt: p.createdAt.toISOString(), drafts };
}

const RECORD_INCLUDE = {
  identity: { select: { officialWebsite: true } },
  assessments: { orderBy: { createdAt: "desc" }, take: 1, select: { readinessScore: true, opportunityScore: true } },
  researchJobs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
  _count: { select: { crmNotes: true } },
};

function toRecord(n: any): NgoRecord {
  return {
    id: n.id, name: n.name, location: locationLabel(n.area ?? null, n.city ?? null) ?? n.queryLocation ?? null, city: n.city ?? null, area: n.area ?? null, address: n.address ?? null,
    latitude: n.latitude ?? null, longitude: n.longitude ?? null, geoBasis: n.geoBasis ?? null, cause: n.primaryCause ?? null,
    website: n.website ?? n.identity?.officialWebsite ?? null, phone: n.phone ?? null, email: n.email ?? null, darpanId: n.darpanId ?? null, darpanStatus: (n.darpanStatus ?? "UNKNOWN") as DarpanStatus, sourceNote: n.sourceNote ?? null,
    source: n.source, contactStatus: n.contactStatus, interestStatus: n.interestStatus, inCrm: !!n.inCrm, notes: n.notes ?? null, meetingScheduled: !!n.meetingScheduled, meetingAt: iso(n.meetingAt), followUpAt: iso(n.followUpAt), contactedAt: iso(n.contactedAt),
    pitchSummary: n.pitchSummary ?? null, matchedServiceCodes: asJson<string[]>(n.matchedServiceCodes, []), audited: !!n.lastResearchedAt,
    websiteStatus: (n.websiteStatus ?? "NOT_AUDITED") as WebsiteStatus, identityStatus: n.identityStatus, lastResearchedAt: iso(n.lastResearchedAt),
    readinessScore: n.assessments?.[0]?.readinessScore ?? null, opportunityScore: n.assessments?.[0]?.opportunityScore ?? null, latestJobId: n.researchJobs?.[0]?.id ?? null,
    noteCount: n._count?.crmNotes ?? 0, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString(),
    ...(Object.fromEntries(PROFILE_KEYS.map((k) => [k, n[k] ?? null])) as Profile),
  };
}

/** Fields an import may fill when a record already exists and the field is empty (DB column names). */
const FILLABLE = ["phone", "email", "website", "address", "area", "latitude", "longitude", "geoBasis", "sourceNote", "darpanId"] as const;

export class PrismaResearchStore implements ResearchStore {
  async createJob(input: NewJob): Promise<JobRecord> {
    const r = await P().researchJob.create({
      data: {
        ngoId: input.ngoId ?? null, queryName: input.queryName, queryLocation: input.queryLocation ?? null, status: "QUEUED", attempt: input.attempt ?? 1, isRefresh: input.isRefresh ?? false,
        parentJobId: input.parentJobId ?? null, candidates: json({ options: [], selectedKey: input.selectedKey }), stageLog: json([]),
      },
    });
    return toJob(r);
  }
  async getJob(id: string) {
    const r = await P().researchJob.findUnique({ where: { id } });
    return r ? toJob(r) : null;
  }
  async updateJob(id: string, patch: JobPatch): Promise<JobRecord> {
    const cur = await P().researchJob.findUnique({ where: { id } });
    if (!cur) throw new Error(`job ${id} not found`);
    const data: Record<string, unknown> = {};
    // A cancelled job stays cancelled: late writes from a still-running pipeline must not resurrect it.
    if (patch.status !== undefined && !(cur.status === "CANCELLED" && patch.status !== "CANCELLED")) data.status = patch.status;
    if (patch.stage !== undefined) data.stage = patch.stage;
    if (patch.progress !== undefined) data.progress = patch.progress;
    if (patch.stageLog !== undefined) data.stageLog = json(patch.stageLog);
    if (patch.candidates !== undefined) data.candidates = json(patch.candidates);
    if (patch.coverage !== undefined) data.coverage = json(patch.coverage ?? {});
    if (patch.error !== undefined) data.error = patch.error;
    if (patch.ngoId !== undefined) data.ngoId = patch.ngoId;
    if (patch.startedAt !== undefined) data.startedAt = patch.startedAt ? new Date(patch.startedAt) : null;
    if (patch.finishedAt !== undefined) data.finishedAt = patch.finishedAt ? new Date(patch.finishedAt) : null;
    return toJob(await P().researchJob.update({ where: { id }, data }));
  }
  async listJobs(limit: number) {
    const rows = await P().researchJob.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    return rows.map(toJob);
  }
  async findCachedJob(queryName: string, queryLocation: string | undefined, maxAgeMs: number) {
    const rows = await P().researchJob.findMany({
      where: { status: { in: ["COMPLETED", "PARTIAL"] }, ngoId: { not: null }, finishedAt: { gte: new Date(Date.now() - maxAgeMs) } },
      orderBy: { finishedAt: "desc" }, take: 200,
    });
    const n = normalizeName(queryName);
    const hit = rows.find((r: any) => normalizeName(r.queryName) === n && (r.queryLocation ?? "") === (queryLocation ?? ""));
    return hit ? toJob(hit) : null;
  }

  async getCachedSearch(query: string, maxAgeMs: number) {
    const r = await P().searchQuery.findFirst({ where: { query, ok: true, ranAt: { gte: new Date(Date.now() - maxAgeMs) } }, orderBy: { ranAt: "desc" } });
    const resp = r?.response as { provider?: string; results?: SearchResult[] } | null | undefined;
    return resp?.results ? { provider: resp.provider ?? r.provider, results: resp.results } : null;
  }
  async recordSearch(jobId: string, rec: { provider: string; query: string; ok: boolean; error?: string; results: SearchResult[] }) {
    await P().searchQuery.create({
      data: {
        jobId, provider: rec.provider, query: rec.query, ok: rec.ok, error: rec.error ?? null, resultCount: rec.results.length,
        response: rec.ok ? json({ provider: rec.provider, results: rec.results.map((r) => ({ url: r.url, title: r.title, snippet: r.snippet, publishedAt: r.publishedAt, score: r.score, provider: r.provider })) }) : undefined,
      },
    });
  }

  async saveResult(jobId: string, r: ResearchResult): Promise<{ ngoId: string }> {
    const catalogue = referenceCatalogue();
    return P().$transaction(async (tx: any) => {
      const job = await tx.researchJob.findUnique({ where: { id: jobId } });
      if (!job) throw new Error(`job ${jobId} not found`);
      const normalized = normalizeName(r.officialName || r.ngoName);
      let ngo = job.ngoId ? await tx.ngo.findUnique({ where: { id: job.ngoId } }) : null;
      if (!ngo) ngo = await tx.ngo.findFirst({ where: { normalizedName: normalized, queryLocation: r.location ?? null } });
      const now = new Date();
      const base = { identityStatus: r.identityStatus, lastResearchedAt: now } as Record<string, unknown>;
      if (r.crm) {
        // Only fill blanks: a person's own entries always win. Derived fields are refreshed every run.
        Object.assign(base, { websiteStatus: r.crm.websiteStatus, darpanStatus: r.crm.darpanStatus, pitchSummary: r.crm.pitchSummary, matchedServiceCodes: json(r.crm.matchedServiceCodes) });
        if (!ngo?.website && r.officialSite) base.website = r.officialSite;
        if (!ngo?.phone && r.crm.contact.phone) base.phone = r.crm.contact.phone;
        if (!ngo?.email && r.crm.contact.email) base.email = r.crm.contact.email;
      }
      ngo = ngo
        ? await tx.ngo.update({ where: { id: ngo.id }, data: base })
        : await tx.ngo.create({ data: { ...base, name: r.officialName || r.ngoName, normalizedName: normalized, queryLocation: r.location ?? null, city: tidyPlace(r.location), source: "SEARCH" } });
      const ngoId: string = ngo.id;
      await tx.researchJob.update({ where: { id: jobId }, data: { ngoId } });

      // identity + compliance
      const statuses: Record<string, string> = {};
      for (const c of r.compliance) statuses[COMPLIANCE_COLUMN[c.key]] = c.status;
      const ident = { officialName: r.officialName, officialWebsite: r.officialSite, matchSignals: json(r.matchSignals), complianceDetail: json(r.compliance), ...statuses };
      await tx.verifiedIdentity.upsert({ where: { ngoId }, create: { ngoId, ...ident }, update: ident });
      if (r.officialDomain) {
        await tx.officialDomain.upsert({
          where: { ngoId_domain: { ngoId, domain: r.officialDomain } },
          create: { ngoId, domain: r.officialDomain, confidence: r.identityConfidence, isPrimary: true, basis: r.matchSignals.join("; ") },
          update: { confidence: r.identityConfidence, isPrimary: true, basis: r.matchSignals.join("; ") },
        });
      }
      await tx.socialProfile.deleteMany({ where: { ngoId } });
      for (const s of r.social) {
        await tx.socialProfile.create({ data: { ngoId, platform: s.platform, url: s.url, accessState: s.accessState, isOfficial: s.isOfficial, observations: json({ basis: s.basis }), checkedAt: now } });
      }

      // evidence
      const urlToId = new Map<string, string>();
      for (const e of r.evidence) {
        const data = {
          jobId, title: e.title ?? null, sourceType: e.sourceType, isOfficial: e.isOfficial, fetchStatus: e.fetchStatus, httpStatus: e.httpStatus ?? null, failureReason: e.failureReason ?? null,
          snapshot: e.snapshot ?? null, summary: e.summary ?? null, excerpt: e.excerpt ?? null, confidence: e.confidence, publishedAt: e.publishedAt ? new Date(e.publishedAt) : null, checkedAt: new Date(e.checkedAt),
        };
        const row = await tx.evidenceSource.upsert({ where: { ngoId_url: { ngoId, url: e.url } }, create: { ngoId, url: e.url, ...data }, update: data });
        urlToId.set(e.url, row.id);
      }

      // findings: keep human review decisions for signals that recur
      const old = await tx.auditFinding.findMany({ where: { ngoId }, select: { signalKey: true, reviewStatus: true, reviewNote: true } });
      const oldBy = new Map<string, any>(old.filter((o: any) => o.signalKey).map((o: any) => [o.signalKey, o]));
      await tx.auditFinding.deleteMany({ where: { ngoId } });
      const keyToFinding = new Map<string, string>();
      for (const f of r.findings) {
        const prev = oldBy.get(f.key);
        const row = await tx.auditFinding.create({
          data: {
            ngoId, jobId, signalKey: f.key, section: f.section, category: f.category, frameworkArea: f.areaId, title: f.title, observation: f.observation, gapState: f.gapState ?? null,
            assessment: f.assessment, whyItMatters: f.whyItMatters ?? null, consequence: f.consequence ?? null, recommendedAction: f.recommendedAction ?? null, confidence: f.confidence,
            priority: f.priority ?? null, mayAddressOffline: f.mayAddressOffline, pageUrl: f.pageUrl ?? null, checkedAt: new Date(f.checkedAt),
            reviewStatus: prev?.reviewStatus ?? "PENDING", reviewNote: prev?.reviewNote ?? null,
          },
        });
        keyToFinding.set(f.key, row.id);
        for (const u of new Set(f.evidenceUrls)) {
          const sid = urlToId.get(u);
          if (sid) await tx.findingEvidence.create({ data: { findingId: row.id, sourceId: sid } });
        }
      }

      // recommendations: keep approvals / price overrides for services that recur
      const oldRecs = await tx.serviceRecommendation.findMany({ where: { ngoId }, include: { service: { select: { code: true } } } });
      const oldRecBy = new Map<string, any>(oldRecs.map((o: any) => [o.service.code, o]));
      await tx.serviceRecommendation.deleteMany({ where: { ngoId } });
      const codes = [...new Set(r.recommendations.map((x) => x.serviceCode))];
      const services = codes.length ? await tx.serviceCatalogue.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } }) : [];
      const svcId = new Map<string, string>(services.map((s: any) => [s.code, s.id]));
      for (const rec of r.recommendations) {
        const serviceId = svcId.get(rec.serviceCode);
        if (!serviceId) throw new Error(`Service ${rec.serviceCode} is not in the database. Run \`npm run db:seed\` to load the catalogue.`);
        const prev = oldRecBy.get(rec.serviceCode);
        await tx.serviceRecommendation.create({
          data: {
            ngoId, findingId: keyToFinding.get(rec.findingKey) ?? null, serviceId, level: rec.level, reason: rec.reason, proposedDeliverables: rec.proposedDeliverables,
            expectedOutcome: rec.expectedOutcome, successMetric: rec.successMetric, priority: rec.priority, confidence: rec.confidence, effort: rec.effort, ngoInputs: rec.ngoInputs,
            thirdPartyDeps: rec.thirdPartyDeps, pricingEligibility: rec.pricingEligibility, packageTier: rec.packageTiers[0] ?? null, isOngoing: rec.isOngoing,
            approval: prev?.approval ?? "PENDING", priceOverrideInr: prev?.priceOverrideInr ?? null, priceOverrideBy: prev?.priceOverrideBy ?? null, priceOverrideNote: prev?.priceOverrideNote ?? null,
            snapshot: json({ areaId: rec.areaId, findingKey: rec.findingKey, evidenceUrls: rec.evidenceUrls, deliveryForm: rec.deliveryForm }),
          },
        });
      }
      void catalogue;

      await tx.maturityAssessment.create({
        data: {
          ngoId, jobId, readinessScore: r.analysis.readiness.overall, opportunityScore: r.analysis.opportunity?.total ?? null, opportunityBreakdown: json(r.analysis.opportunity?.breakdown ?? []),
          categories: json({ readiness: r.analysis.readiness.categories, areas: r.analysis.areas, top: r.analysis.top, doNotPitch: r.analysis.doNotPitch }),
        },
      });
      return { ngoId };
    });
  }

  async getActivePolicy(): Promise<PolicyConfig | null> {
    const p = await P().pricingPolicy.findFirst({ where: { isActive: true, status: "APPROVED" }, orderBy: { approvedAt: "desc" } });
    if (!p) return null;
    const cfg = (p.config ?? {}) as { subsidizedServiceCodes?: string[]; maintenance?: PolicyConfig["maintenance"] };
    return {
      id: p.id, name: p.name, model: p.model, status: p.status, isActive: p.isActive, approvedBy: p.approvedBy, gstExtra: p.gstExtra,
      thirdPartyCostRules: asJson<string[]>(p.thirdPartyCostRules, []), subsidizedServiceCodes: cfg.subsidizedServiceCodes ?? [], maintenance: cfg.maintenance ?? { mode: "NONE" },
    };
  }

  async getNgoView(ngoId: string): Promise<NgoView | null> {
    const ngo = await P().ngo.findUnique({
      where: { id: ngoId },
      include: {
        identity: true,
        socialProfiles: true,
        evidence: true,
        findings: { include: { evidence: { include: { source: true } } } },
        recommendations: { include: { service: true }, orderBy: { createdAt: "asc" } },
        assessments: { orderBy: { createdAt: "desc" }, take: 1 },
        pitches: { include: { drafts: true }, orderBy: { createdAt: "desc" } },
        researchJobs: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { crmNotes: true } },
      },
    });
    if (!ngo) return null;
    const catalogue = referenceCatalogue();
    const a = ngo.assessments[0];
    const cat = (a?.categories ?? {}) as { readiness?: any[]; areas?: any[]; top?: any[]; doNotPitch?: Recommendation[] };
    const analysis: AnalysisSummary | null = a
      ? {
          readiness: { overall: a.readinessScore ?? null, categories: cat.readiness ?? [] },
          opportunity: a.opportunityScore === null || a.opportunityScore === undefined ? null : { total: a.opportunityScore, breakdown: asJson(a.opportunityBreakdown, []) },
          areas: cat.areas ?? [], top: cat.top ?? [], doNotPitch: cat.doNotPitch ?? [],
        }
      : null;

    const evidence: EvidenceView[] = ngo.evidence.map((e: any): EvidenceView => ({
      id: e.id, url: e.url, title: e.title ?? undefined, sourceType: e.sourceType, isOfficial: e.isOfficial, fetchStatus: e.fetchStatus, httpStatus: e.httpStatus ?? undefined,
      failureReason: e.failureReason ?? undefined, snapshot: e.snapshot ?? undefined, summary: e.summary ?? undefined, excerpt: e.excerpt ?? undefined, confidence: e.confidence,
      publishedAt: iso(e.publishedAt) ?? undefined, checkedAt: e.checkedAt.toISOString(),
    }));
    const findings: FindingView[] = ngo.findings.map((f: any): FindingView => ({
      id: f.id, key: f.signalKey ?? f.id, areaId: f.frameworkArea, section: f.section, category: f.category, title: f.title, observation: f.observation, gapState: f.gapState ?? undefined,
      assessment: f.assessment, confidence: f.confidence, priority: f.priority ?? undefined, whyItMatters: f.whyItMatters ?? undefined, consequence: f.consequence ?? undefined,
      recommendedAction: f.recommendedAction ?? undefined, mayAddressOffline: f.mayAddressOffline, pageUrl: f.pageUrl ?? undefined, evidenceUrls: f.evidence.map((x: any) => x.source.url),
      checkedAt: f.checkedAt.toISOString(), reviewStatus: f.reviewStatus, reviewNote: f.reviewNote ?? null,
    }));
    const recommendations: RecommendationView[] = ngo.recommendations.map((x: any): RecommendationView => {
      const svc = catalogue.byCode.get(x.service.code);
      const snap = (x.snapshot ?? {}) as { areaId?: string; findingKey?: string; evidenceUrls?: string[]; deliveryForm?: Recommendation["deliveryForm"] };
      return {
        id: x.id, areaId: (snap.areaId ?? "website-ux") as Recommendation["areaId"], findingKey: snap.findingKey ?? "", serviceCode: x.service.code, serviceName: x.service.name,
        practiceArea: svc?.practiceAreaName ?? "", level: x.level, reason: x.reason, proposedDeliverables: x.proposedDeliverables, expectedOutcome: x.expectedOutcome ?? "", successMetric: x.successMetric ?? "",
        effort: (x.effort ?? "Medium") as Recommendation["effort"], ngoInputs: x.ngoInputs ?? "", thirdPartyDeps: x.thirdPartyDeps ?? "", priority: x.priority, confidence: x.confidence,
        pricingEligibility: x.pricingEligibility, packageTiers: (svc?.tiers.map((t) => t.tier) ?? []) as Recommendation["packageTiers"], addOnNames: svc?.addOns.map((o) => o.name) ?? [],
        isOngoing: x.isOngoing, deliveryForm: snap.deliveryForm ?? "SEPARATE_PROJECT", evidenceUrls: snap.evidenceUrls ?? [], approval: x.approval,
        priceOverride: x.priceOverrideInr === null || x.priceOverrideInr === undefined ? null : { amountInr: x.priceOverrideInr, approvedBy: x.priceOverrideBy ?? "unknown", note: x.priceOverrideNote ?? undefined },
      };
    });
    const identity = ngo.identity
      ? { officialName: ngo.identity.officialName, officialWebsite: ngo.identity.officialWebsite ?? null, matchSignals: asJson<string[]>(ngo.identity.matchSignals, []), compliance: asJson<ComplianceItem[]>(ngo.identity.complianceDetail, []) }
      : null;
    const social = ngo.socialProfiles.map((s: any): SocialDraft & { checkedAt?: string } => ({
      platform: s.platform, url: s.url ?? null, accessState: s.accessState, isOfficial: s.isOfficial, basis: (s.observations as { basis?: string } | null)?.basis ?? "", checkedAt: s.checkedAt.toISOString(),
    }));
    return {
      ngo: toRecord(ngo),
      identity, social, job: ngo.researchJobs[0] ? toJob(ngo.researchJobs[0]) : null, evidence, findings, recommendations, analysis, pitches: ngo.pitches.map(toPitchView), policy: await this.getActivePolicy(),
    };
  }

  async listRecords(filter: NgoFilter = {}): Promise<NgoRecord[]> {
    // Filtering happens in JS so city/cause matching is case-insensitive on SQLite and Postgres alike (the directory is thousands of rows at most).
    const rows = await P().ngo.findMany({ include: RECORD_INCLUDE, take: 5000 });
    return rows.map(toRecord).filter((r: NgoRecord) => matchesFilter(r, filter))
      .sort((a: NgoRecord, b: NgoRecord) => (b.lastResearchedAt ?? b.createdAt).localeCompare(a.lastResearchedAt ?? a.createdAt) || a.name.localeCompare(b.name));
  }
  async getRecord(id: string) {
    const n = await P().ngo.findUnique({ where: { id }, include: RECORD_INCLUDE });
    return n ? toRecord(n) : null;
  }
  async upsertEntries(entries: DirectoryEntry[], actor: string, opts: { fillBlanks?: boolean } = {}) {
    const created: NgoRecord[] = [];
    const existing: NgoRecord[] = [];
    const updated: NgoRecord[] = [];
    for (const e of entries) {
      const normalizedName = normalizeName(e.name);
      const city = tidyPlace(e.city);
      const hit = await P().ngo.findFirst({ where: { normalizedName, city }, include: RECORD_INCLUDE });
      if (hit) {
        if (opts.fillBlanks) {
          const data: Record<string, unknown> = {};
          const blank = (v: unknown) => v === null || v === undefined || v === "";
          for (const k of [...FILLABLE, ...PROFILE_KEYS] as const) if (blank(hit[k]) && !blank((e as unknown as Record<string, unknown>)[k])) data[k] = (e as unknown as Record<string, unknown>)[k];
          if (blank(hit.primaryCause) && e.cause) data.primaryCause = e.cause;
          if (Object.keys(data).length) {
            const row = await P().ngo.update({ where: { id: hit.id }, data, include: RECORD_INCLUDE });
            await this.log("Ngo", hit.id, `directory:fill:${e.source}`, actor);
            updated.push(toRecord(row)); existing.push(toRecord(row)); continue;
          }
        }
        existing.push(toRecord(hit)); continue;
      }
      const row = await P().ngo.create({
        data: {
          name: e.name.trim(), normalizedName, queryLocation: city, city, area: e.area ?? null, primaryCause: e.cause ?? null, address: e.address ?? null, latitude: e.latitude ?? null,
          longitude: e.longitude ?? null, geoBasis: e.geoBasis ?? null, website: e.website ?? null, phone: e.phone ?? null, email: e.email ?? null, darpanId: e.darpanId ?? null, darpanStatus: e.darpanStatus ?? "UNKNOWN", sourceNote: e.sourceNote ?? null, source: e.source,
          contactStatus: e.contactStatus ?? "NOT_CONTACTED", interestStatus: e.interestStatus ?? "PENDING", contactedAt: e.contactedAt ? new Date(e.contactedAt) : null,
          ...Object.fromEntries(PROFILE_KEYS.map((k) => [k, e[k] ?? null])),
        },
        include: RECORD_INCLUDE,
      });
      await this.log("Ngo", row.id, `directory:add:${e.source}`, actor);
      created.push(toRecord(row));
    }
    return { created, existing, updated };
  }
  private async patchOne(id: string, patch: NgoPatch, actor: string): Promise<NgoRecord | null> {
    const cur = await P().ngo.findUnique({ where: { id }, select: { contactStatus: true, interestStatus: true, inCrm: true, contactedAt: true, meetingScheduled: true, meetingAt: true } });
    if (!cur) return null;
    const data: Record<string, unknown> = {};
    for (const k of ["contactStatus", "interestStatus", "inCrm", "notes", "phone", "email", "website", "cause", "area", "address", "latitude", "longitude", ...PROFILE_KEYS] as const) {
      if (patch[k] !== undefined) data[k === "cause" ? "primaryCause" : k] = patch[k];
    }
    if (patch.followUpAt !== undefined) data.followUpAt = patch.followUpAt ? new Date(patch.followUpAt) : null;
    if (patch.meetingAt !== undefined) { data.meetingAt = patch.meetingAt ? new Date(patch.meetingAt) : null; if (patch.meetingAt) data.meetingScheduled = true; }
    if (patch.meetingScheduled !== undefined) { data.meetingScheduled = patch.meetingScheduled; if (!patch.meetingScheduled) data.meetingAt = null; }
    if (patch.contactedAt !== undefined) data.contactedAt = patch.contactedAt ? new Date(patch.contactedAt) : null;
    else if (patch.contactStatus) {
      const at = contactedAtFor({ contactStatus: cur.contactStatus, contactedAt: iso(cur.contactedAt) }, patch.contactStatus, new Date().toISOString());
      data.contactedAt = at ? new Date(at) : null;
    }
    const lines = changeLines(cur, patch);
    const row = await P().ngo.update({ where: { id }, data, include: RECORD_INCLUDE });
    for (const content of lines) await P().crmNote.create({ data: { ngoId: id, content, author: actor } });
    return toRecord(lines.length ? await P().ngo.findUnique({ where: { id }, include: RECORD_INCLUDE }) : row);
  }
  async updateRecord(id: string, patch: NgoPatch, actor: string) {
    const out = await this.patchOne(id, patch, actor);
    if (!out) throw new Error("ngo not found");
    await this.log("Ngo", id, "crm:update", actor, undefined, patch);
    return out;
  }
  async bulkUpdate(ids: string[], patch: NgoPatch, actor: string) {
    const out: NgoRecord[] = [];
    for (const id of new Set(ids)) { const r = await this.patchOne(id, patch, actor); if (r) out.push(r); }
    await this.log("Ngo", "bulk", "crm:bulk", actor, undefined, { ids, patch });
    return out;
  }
  async listCrmNotes(ngoId: string): Promise<CrmNoteView[]> {
    const rows = await P().crmNote.findMany({ where: { ngoId }, orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map((n: any) => ({ id: n.id, ngoId: n.ngoId, content: n.content, author: n.author, createdAt: n.createdAt.toISOString() }));
  }
  async addCrmNote(ngoId: string, content: string, author: string): Promise<CrmNoteView> {
    const n = await P().crmNote.create({ data: { ngoId, content, author } });
    return { id: n.id, ngoId: n.ngoId, content: n.content, author: n.author, createdAt: n.createdAt.toISOString() };
  }

  // ── pricing policy settings ──────────────────────────────────────────────
  private toPolicy(p: any): PolicyConfig {
    const cfg = (p.config ?? {}) as { subsidizedServiceCodes?: string[]; maintenance?: PolicyConfig["maintenance"] };
    return {
      id: p.id, name: p.name, model: p.model, status: p.status, isActive: p.isActive, approvedBy: p.approvedBy, gstExtra: p.gstExtra,
      thirdPartyCostRules: asJson<string[]>(p.thirdPartyCostRules, []), subsidizedServiceCodes: cfg.subsidizedServiceCodes ?? [], maintenance: cfg.maintenance ?? { mode: "NONE" },
    };
  }
  async listPolicies() {
    const rows = await P().pricingPolicy.findMany({ orderBy: { updatedAt: "desc" } });
    return rows.map((p: any) => this.toPolicy(p));
  }
  async savePolicy(input: Omit<PolicyConfig, "status" | "isActive" | "approvedBy">, actor: string) {
    const data = {
      name: input.name, model: input.model, gstExtra: input.gstExtra, thirdPartyCostRules: json(input.thirdPartyCostRules ?? []),
      config: json({ subsidizedServiceCodes: input.subsidizedServiceCodes, maintenance: input.maintenance }),
      // Any edit invalidates a previous approval: a person must approve the new terms.
      status: "DRAFT", isActive: false, approvedBy: null, approvedAt: null,
    };
    const row = input.id
      ? await P().pricingPolicy.update({ where: { id: input.id }, data })
      : await P().pricingPolicy.upsert({ where: { name: input.name }, create: data, update: data });
    await this.log("PricingPolicy", row.id, "save", actor);
    return this.toPolicy(row);
  }
  async setPolicyState(id: string, state: "APPROVE" | "RETIRE", actor: string) {
    const row = await P().$transaction(async (tx: any) => {
      if (state === "APPROVE") {
        await tx.pricingPolicy.updateMany({ where: { isActive: true, NOT: { id } }, data: { isActive: false } });
        return tx.pricingPolicy.update({ where: { id }, data: { status: "APPROVED", isActive: true, approvedBy: actor, approvedAt: new Date() } });
      }
      return tx.pricingPolicy.update({ where: { id }, data: { status: "RETIRED", isActive: false } });
    });
    await this.log("PricingPolicy", id, state.toLowerCase(), actor);
    return this.toPolicy(row);
  }
  async deleteNgo(ngoId: string, actor: string) {
    await P().$transaction([P().auditLog.create({ data: { entityType: "Ngo", entityId: ngoId, action: "delete", actor } }), P().ngo.delete({ where: { id: ngoId } })]);
  }

  private async log(entityType: string, entityId: string, action: string, actor: string, before?: unknown, after?: unknown) {
    await P().auditLog.create({ data: { entityType, entityId, action, actor, before: before === undefined ? undefined : json(before), after: after === undefined ? undefined : json(after) } });
  }

  async reviewFinding(id: string, patch: { reviewStatus: FindingView["reviewStatus"]; reviewNote?: string }, actor: string) {
    const before = await P().auditFinding.findUnique({ where: { id }, select: { reviewStatus: true, reviewNote: true } });
    if (!before) throw new Error("finding not found");
    await P().auditFinding.update({ where: { id }, data: { reviewStatus: patch.reviewStatus, reviewNote: patch.reviewNote ?? null } });
    await this.log("AuditFinding", id, `review:${patch.reviewStatus}`, actor, before, patch);
  }
  async reviewRecommendation(id: string, patch: { approval?: RecommendationView["approval"]; priceOverride?: { amountInr: number; note?: string } | null }, actor: string) {
    const before = await P().serviceRecommendation.findUnique({ where: { id }, select: { approval: true, priceOverrideInr: true, priceOverrideNote: true } });
    if (!before) throw new Error("recommendation not found");
    const data: Record<string, unknown> = {};
    if (patch.approval) data.approval = patch.approval;
    if (patch.priceOverride === null) Object.assign(data, { priceOverrideInr: null, priceOverrideBy: null, priceOverrideNote: null });
    else if (patch.priceOverride) Object.assign(data, { priceOverrideInr: patch.priceOverride.amountInr, priceOverrideBy: actor, priceOverrideNote: patch.priceOverride.note ?? null });
    await P().serviceRecommendation.update({ where: { id }, data });
    await this.log("ServiceRecommendation", id, "review", actor, before, patch);
  }
  async savePitch(ngoId: string, jobId: string | null, policyId: string | null, bundle: PitchBundle, parentPitchId?: string): Promise<PitchView> {
    const count = await P().outreachPitch.count({ where: { ngoId } });
    const perChannel: Record<string, unknown> = {};
    for (const d of bundle.drafts) perChannel[d.channel] = { score: d.score, breakdown: d.breakdown, origin: d.origin, lint: d.lint, notes: d.notes };
    const row = await P().outreachPitch.create({
      data: {
        ngoId, jobId, policyId, tone: bundle.tone, version: count + 1, parentPitchId: parentPitchId ?? null, scoreTotal: bundle.totalScore,
        scoreBreakdown: json({ perChannel, warnings: bundle.warnings, generatedBy: bundle.generatedBy }),
        drafts: { create: bundle.drafts.map((d) => ({ channel: d.channel, subject: d.subject ?? null, body: d.body })) },
      },
      include: { drafts: true },
    });
    return toPitchView(row);
  }
  async editDraft(draftId: string, patch: { editedBody?: string | null; status?: "DRAFT" | "APPROVED" | "REJECTED" }, actor: string) {
    const before = await P().pitchDraft.findUnique({ where: { id: draftId }, select: { editedBody: true, status: true } });
    if (!before) throw new Error("draft not found");
    const data: Record<string, unknown> = {};
    if (patch.editedBody !== undefined) data.editedBody = patch.editedBody;
    if (patch.status) data.status = patch.status;
    await P().pitchDraft.update({ where: { id: draftId }, data });
    await this.log("PitchDraft", draftId, "edit", actor, before, patch);
  }
  async addEvidenceNote(ngoId: string, input: { url: string; title?: string; summary?: string }, actor: string): Promise<EvidenceView> {
    const now = new Date();
    const row = await P().evidenceSource.upsert({
      where: { ngoId_url: { ngoId, url: input.url } },
      create: { ngoId, url: input.url, title: input.title ?? null, summary: input.summary ?? null, sourceType: "USER_ADDED", isOfficial: false, fetchStatus: "NOT_ATTEMPTED", confidence: "MEDIUM", addedByUser: true, checkedAt: now },
      update: { title: input.title ?? null, summary: input.summary ?? null },
    });
    await this.log("EvidenceSource", row.id, "add", actor);
    const e: EvidenceDraft = { url: row.url, title: row.title ?? undefined, sourceType: row.sourceType, isOfficial: row.isOfficial, fetchStatus: row.fetchStatus, summary: row.summary ?? undefined, confidence: row.confidence, checkedAt: row.checkedAt.toISOString() };
    return { ...e, id: row.id };
  }
  async recordExport(ngoId: string, kind: string, mode: "INTERNAL" | "NGO_FACING", actor: string) {
    await P().exportRecord.create({ data: { ngoId, kind, mode } });
    await this.log("Ngo", ngoId, `export:${kind}:${mode}`, actor);
  }
}
