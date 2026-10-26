import { randomUUID } from "node:crypto";
import type { PolicyConfig } from "@/lib/pricing/policy";
import type { PitchBundle } from "@/lib/pitch/generate";
import type { SearchResult } from "@/lib/search/types";
import { normalizeName } from "./text";
import type {
  EvidenceView, FindingView, JobPatch, JobRecord, NewJob, NgoView, PitchView, RecommendationView, ResearchResult, ResearchStore,
} from "./store";
import { changeLines, contactedAtFor, matchesFilter, PROFILE_KEYS, emptyProfile, type CrmNoteView, type DirectoryEntry, type NgoFilter, type NgoPatch, type NgoRecord } from "@/lib/crm/types";
import { locationLabel, tidyPlace } from "@/lib/geo/areas";
import type { EvidenceDraft } from "./types";

type NgoRow = Omit<NgoRecord, "audited" | "noteCount"> & { normalized: string; queryLocation: string | null };
interface NgoData {
  result: ResearchResult;
  evidence: EvidenceView[];
  findings: FindingView[];
  recs: RecommendationView[];
}

/** Fields an import may fill when a record already exists and the field is empty. */
const FILLABLE = ["phone", "email", "website", "address", "cause", "area", "latitude", "longitude", "geoBasis", "sourceNote", "darpanId"] as const;

/** In-memory store: used by tests and for a throw-away demo (`RESEARCH_STORE=memory`). Nothing persists. */
export class MemoryResearchStore implements ResearchStore {
  jobs = new Map<string, JobRecord>();
  ngos = new Map<string, NgoRow>();
  data = new Map<string, NgoData>();
  pitches = new Map<string, PitchView[]>();
  searchCache: { query: string; provider: string; results: SearchResult[]; at: number }[] = [];
  searchLog: { jobId: string; provider: string; query: string; ok: boolean; error?: string }[] = [];
  audit: { entityType: string; entityId: string; action: string; actor: string; detail?: unknown }[] = [];
  exports: { ngoId: string; kind: string; mode: string; actor: string }[] = [];
  policy: PolicyConfig | null = null;
  policies: PolicyConfig[] = [];
  crmNotes = new Map<string, CrmNoteView[]>();

  async createJob(input: NewJob): Promise<JobRecord> {
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: randomUUID(), ngoId: input.ngoId ?? null, queryName: input.queryName, queryLocation: input.queryLocation ?? null, status: "QUEUED", stage: null, progress: 0,
      stageLog: [], candidates: { options: [], selectedKey: input.selectedKey }, coverage: null, attempt: input.attempt ?? 1, isRefresh: input.isRefresh ?? false,
      parentJobId: input.parentJobId ?? null, error: null, startedAt: null, finishedAt: null, createdAt: now,
    };
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }
  async getJob(id: string) { const j = this.jobs.get(id); return j ? structuredClone(j) : null; }
  async updateJob(id: string, patch: JobPatch): Promise<JobRecord> {
    const j = this.jobs.get(id);
    if (!j) throw new Error(`job ${id} not found`);
    // A cancelled job stays cancelled: late writes from a still-running pipeline must not resurrect it.
    if (j.status === "CANCELLED" && patch.status && patch.status !== "CANCELLED") delete patch.status;
    Object.assign(j, structuredClone(patch));
    return structuredClone(j);
  }
  async listJobs(limit: number) { return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((j) => structuredClone(j)); }
  async findCachedJob(queryName: string, queryLocation: string | undefined, maxAgeMs: number) {
    const n = normalizeName(queryName);
    const hit = [...this.jobs.values()]
      .filter((j) => (j.status === "COMPLETED" || j.status === "PARTIAL") && j.ngoId && normalizeName(j.queryName) === n && (j.queryLocation ?? "") === (queryLocation ?? "") && Date.now() - Date.parse(j.finishedAt ?? j.createdAt) < maxAgeMs)
      .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))[0];
    return hit ? structuredClone(hit) : null;
  }

  async getCachedSearch(query: string, maxAgeMs: number) {
    const hit = this.searchCache.find((c) => c.query === query && Date.now() - c.at < maxAgeMs);
    return hit ? { provider: hit.provider, results: structuredClone(hit.results) } : null;
  }
  async recordSearch(jobId: string, rec: { provider: string; query: string; ok: boolean; error?: string; results: SearchResult[] }) {
    this.searchLog.push({ jobId, provider: rec.provider, query: rec.query, ok: rec.ok, error: rec.error });
    if (rec.ok) this.searchCache.unshift({ query: rec.query, provider: rec.provider, results: structuredClone(rec.results), at: Date.now() });
  }

  async saveResult(jobId: string, r: ResearchResult) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`job ${jobId} not found`);
    const norm = normalizeName(r.officialName || r.ngoName);
    let ngo = (job.ngoId && this.ngos.get(job.ngoId)) || [...this.ngos.values()].find((n) => n.normalized === norm && (n.queryLocation ?? "") === (r.location ?? ""));
    const now = new Date().toISOString();
    if (!ngo) {
      const city = tidyPlace(r.location);
      ngo = { ...this.blank(randomUUID(), r.officialName || r.ngoName, city, null, "SEARCH"), normalized: norm, queryLocation: r.location ?? null };
      this.ngos.set(ngo.id, ngo);
    }
    ngo.identityStatus = r.identityStatus;
    if (r.crm) {
      // Only fill blanks: a person's own entries always win.
      if (!ngo.website && r.officialSite) ngo.website = r.officialSite;
      if (!ngo.phone && r.crm.contact.phone) ngo.phone = r.crm.contact.phone;
      if (!ngo.email && r.crm.contact.email) ngo.email = r.crm.contact.email;
      ngo.websiteStatus = r.crm.websiteStatus;
      ngo.darpanStatus = r.crm.darpanStatus;
      ngo.pitchSummary = r.crm.pitchSummary;
      ngo.matchedServiceCodes = [...r.crm.matchedServiceCodes];
    }
    ngo.lastResearchedAt = now;
    ngo.latestJobId = jobId;
    job.ngoId = ngo.id;

    const prev = this.data.get(ngo.id);
    const evidence: EvidenceView[] = r.evidence.map((e) => ({ ...e, id: prev?.evidence.find((p) => p.url === e.url)?.id ?? randomUUID() }));
    // Carry human review decisions over a refresh when the same signal / service recurs.
    const findings: FindingView[] = r.findings.map((f) => {
      const old = prev?.findings.find((p) => p.key === f.key);
      return { ...f, id: randomUUID(), reviewStatus: old?.reviewStatus ?? "PENDING", reviewNote: old?.reviewNote ?? null };
    });
    const recs: RecommendationView[] = r.recommendations.map((x) => {
      const old = prev?.recs.find((p) => p.serviceCode === x.serviceCode);
      return { ...x, id: randomUUID(), approval: old?.approval ?? "PENDING", priceOverride: old?.priceOverride ?? null };
    });
    this.data.set(ngo.id, { result: structuredClone(r), evidence, findings, recs });
    return { ngoId: ngo.id };
  }

  async getActivePolicy() { return this.policy ? structuredClone(this.policy) : null; }

  async getNgoView(ngoId: string): Promise<NgoView | null> {
    const ngo = this.ngos.get(ngoId);
    const d = this.data.get(ngoId);
    if (!ngo || !d) return null;
    return structuredClone({
      ngo: this.rec(ngo),
      identity: { officialName: d.result.officialName, officialWebsite: d.result.officialSite, matchSignals: d.result.matchSignals, compliance: d.result.compliance },
      social: d.result.social,
      job: ngo.latestJobId ? this.jobs.get(ngo.latestJobId) ?? null : null,
      evidence: d.evidence, findings: d.findings, recommendations: d.recs, analysis: d.result.analysis,
      pitches: this.pitches.get(ngoId) ?? [], policy: this.policy,
    });
  }

  // ── directory + CRM ──────────────────────────────────────────────────────
  private blank(id: string, name: string, city: string | null, area: string | null, source: NgoRecord["source"]): NgoRow {
    const now = new Date().toISOString();
    return {
      id, name, normalized: normalizeName(name), queryLocation: city, location: locationLabel(area, city), city, area, address: null, latitude: null, longitude: null, geoBasis: null, cause: null,
      website: null, phone: null, email: null, darpanId: null, darpanStatus: "UNKNOWN", sourceNote: null, source, contactStatus: "NOT_CONTACTED", interestStatus: "PENDING", inCrm: false, notes: null,
      followUpAt: null, meetingScheduled: false, meetingAt: null, contactedAt: null, pitchSummary: null, matchedServiceCodes: [], websiteStatus: "NOT_AUDITED", identityStatus: "UNVERIFIED", lastResearchedAt: null,
      readinessScore: null, opportunityScore: null, latestJobId: null, createdAt: now, updatedAt: now, ...emptyProfile(),
    };
  }
  private rec(n: NgoRow): NgoRecord {
    const d = this.data.get(n.id);
    const { normalized, queryLocation, ...rest } = n;
    void normalized; void queryLocation;
    return structuredClone({
      ...rest, audited: !!d, noteCount: this.crmNotes.get(n.id)?.length ?? 0,
      website: n.website ?? d?.result.officialSite ?? null,
      readinessScore: d?.result.analysis.readiness.overall ?? null, opportunityScore: d?.result.analysis.opportunity?.total ?? null,
    });
  }
  async listRecords(filter: NgoFilter = {}): Promise<NgoRecord[]> {
    return [...this.ngos.values()].map((n) => this.rec(n)).filter((r) => matchesFilter(r, filter))
      .sort((a, b) => (b.lastResearchedAt ?? b.createdAt).localeCompare(a.lastResearchedAt ?? a.createdAt) || a.name.localeCompare(b.name));
  }
  async getRecord(id: string) { const n = this.ngos.get(id); return n ? this.rec(n) : null; }
  async upsertEntries(entries: DirectoryEntry[], actor: string, opts: { fillBlanks?: boolean } = {}) {
    const created: NgoRecord[] = [];
    const existing: NgoRecord[] = [];
    const updated: NgoRecord[] = [];
    for (const e of entries) {
      const norm = normalizeName(e.name);
      const city = tidyPlace(e.city);
      const hit = [...this.ngos.values()].find((n) => n.normalized === norm && (n.city ?? "") === (city ?? ""));
      if (hit) {
        if (opts.fillBlanks) {
          let changed = false;
          for (const k of [...FILLABLE, ...PROFILE_KEYS] as const) {
            const cur = (hit as unknown as Record<string, unknown>)[k];
            const next = (e as unknown as Record<string, unknown>)[k];
            if ((cur === null || cur === undefined || cur === "") && next !== undefined && next !== null && next !== "") { (hit as unknown as Record<string, unknown>)[k] = next; changed = true; }
          }
          if (changed) { hit.location = locationLabel(hit.area, hit.city); hit.updatedAt = new Date().toISOString(); updated.push(this.rec(hit)); this.audit.push({ entityType: "Ngo", entityId: hit.id, action: `directory:fill:${e.source}`, actor }); }
        }
        existing.push(this.rec(hit)); continue;
      }
      const row = { ...this.blank(randomUUID(), e.name.trim(), city, e.area ?? null, e.source), queryLocation: city };
      Object.assign(row, {
        cause: e.cause ?? null, address: e.address ?? null, latitude: e.latitude ?? null, longitude: e.longitude ?? null, geoBasis: e.geoBasis ?? null,
        website: e.website ?? null, phone: e.phone ?? null, email: e.email ?? null, darpanId: e.darpanId ?? null,
        darpanStatus: e.darpanStatus ?? "UNKNOWN", sourceNote: e.sourceNote ?? null,
        contactStatus: e.contactStatus ?? "NOT_CONTACTED", interestStatus: e.interestStatus ?? "PENDING", contactedAt: e.contactedAt ?? null,
        ...Object.fromEntries(PROFILE_KEYS.map((k) => [k, e[k] ?? null])),
      });
      this.ngos.set(row.id, row);
      this.audit.push({ entityType: "Ngo", entityId: row.id, action: `directory:add:${e.source}`, actor });
      created.push(this.rec(row));
    }
    return { created, existing, updated };
  }
  private applyPatch(n: NgoRow, patch: NgoPatch, actor: string) {
    const now = new Date().toISOString();
    for (const line of changeLines(n, patch)) this.pushNote(n.id, line, actor, true);
    n.contactedAt = patch.contactedAt !== undefined ? patch.contactedAt : contactedAtFor(n, patch.contactStatus, now);
    if (patch.contactStatus) n.contactStatus = patch.contactStatus;
    if (patch.interestStatus) n.interestStatus = patch.interestStatus;
    if (patch.inCrm !== undefined) n.inCrm = patch.inCrm;
    for (const k of ["notes", "phone", "email", "website", "followUpAt", "cause", "area", "address", "latitude", "longitude"] as const) {
      if (patch[k] !== undefined) (n as unknown as Record<string, unknown>)[k] = patch[k];
    }
    for (const k of PROFILE_KEYS) if (patch[k] !== undefined) n[k] = patch[k] as string | null;
    if (patch.meetingAt !== undefined) { n.meetingAt = patch.meetingAt; if (patch.meetingAt) n.meetingScheduled = true; }
    if (patch.meetingScheduled !== undefined) { n.meetingScheduled = patch.meetingScheduled; if (!patch.meetingScheduled) n.meetingAt = null; }
    if (patch.area !== undefined) n.location = locationLabel(n.area, n.city);
    n.updatedAt = now;
  }
  async updateRecord(id: string, patch: NgoPatch, actor: string) {
    const n = this.ngos.get(id);
    if (!n) throw new Error("ngo not found");
    this.applyPatch(n, patch, actor);
    this.audit.push({ entityType: "Ngo", entityId: id, action: "crm:update", actor, detail: patch });
    return this.rec(n);
  }
  async bulkUpdate(ids: string[], patch: NgoPatch, actor: string) {
    const out: NgoRecord[] = [];
    for (const id of new Set(ids)) {
      const n = this.ngos.get(id);
      if (!n) continue;
      this.applyPatch(n, patch, actor);
      out.push(this.rec(n));
    }
    this.audit.push({ entityType: "Ngo", entityId: "bulk", action: "crm:bulk", actor, detail: { ids, patch } });
    return out;
  }
  private pushNote(ngoId: string, content: string, author: string, system = false) {
    const note: CrmNoteView = { id: randomUUID(), ngoId, content: system ? content : content, author, createdAt: new Date().toISOString() };
    this.crmNotes.set(ngoId, [note, ...(this.crmNotes.get(ngoId) ?? [])]);
    return note;
  }
  async listCrmNotes(ngoId: string) { return structuredClone(this.crmNotes.get(ngoId) ?? []); }
  async addCrmNote(ngoId: string, content: string, author: string) {
    if (!this.ngos.has(ngoId)) throw new Error("ngo not found");
    return structuredClone(this.pushNote(ngoId, content, author));
  }

  // ── pricing policy settings ──────────────────────────────────────────────
  async listPolicies() { return structuredClone(this.policies); }
  async savePolicy(input: Omit<PolicyConfig, "status" | "isActive" | "approvedBy">, actor: string) {
    const existing = this.policies.find((p) => (input.id && p.id === input.id) || p.name === input.name);
    // Any edit invalidates a previous approval: a person must approve the new terms.
    const next: PolicyConfig = { ...structuredClone(input), id: existing?.id ?? randomUUID(), status: "DRAFT", isActive: false, approvedBy: null };
    if (existing) this.policies = this.policies.map((p) => (p === existing ? next : p)); else this.policies.push(next);
    if (this.policy?.id === next.id) this.policy = null;
    this.audit.push({ entityType: "PricingPolicy", entityId: next.id as string, action: "save", actor });
    return structuredClone(next);
  }
  async setPolicyState(id: string, state: "APPROVE" | "RETIRE", actor: string) {
    const p = this.policies.find((x) => x.id === id);
    if (!p) throw new Error("policy not found");
    if (state === "APPROVE") {
      for (const o of this.policies) if (o !== p && o.isActive) o.isActive = false;
      p.status = "APPROVED"; p.isActive = true; p.approvedBy = actor;
      this.policy = structuredClone(p);
    } else {
      p.status = "RETIRED"; p.isActive = false;
      if (this.policy?.id === id) this.policy = null;
    }
    this.audit.push({ entityType: "PricingPolicy", entityId: id, action: state.toLowerCase(), actor });
    return structuredClone(p);
  }
  async deleteNgo(ngoId: string, actor: string) {
    this.ngos.delete(ngoId); this.data.delete(ngoId); this.pitches.delete(ngoId); this.crmNotes.delete(ngoId);
    this.audit.push({ entityType: "Ngo", entityId: ngoId, action: "delete", actor });
  }

  async reviewFinding(id: string, patch: { reviewStatus: FindingView["reviewStatus"]; reviewNote?: string }, actor: string) {
    for (const d of this.data.values()) {
      const f = d.findings.find((x) => x.id === id);
      if (f) { f.reviewStatus = patch.reviewStatus; f.reviewNote = patch.reviewNote ?? null; this.audit.push({ entityType: "AuditFinding", entityId: id, action: `review:${patch.reviewStatus}`, actor }); return; }
    }
    throw new Error("finding not found");
  }
  async reviewRecommendation(id: string, patch: { approval?: RecommendationView["approval"]; priceOverride?: { amountInr: number; note?: string } | null }, actor: string) {
    for (const d of this.data.values()) {
      const r = d.recs.find((x) => x.id === id);
      if (r) {
        if (patch.approval) r.approval = patch.approval;
        if (patch.priceOverride === null) r.priceOverride = null;
        else if (patch.priceOverride) r.priceOverride = { amountInr: patch.priceOverride.amountInr, note: patch.priceOverride.note, approvedBy: actor };
        this.audit.push({ entityType: "ServiceRecommendation", entityId: id, action: "review", actor, detail: patch });
        return;
      }
    }
    throw new Error("recommendation not found");
  }
  async savePitch(ngoId: string, jobId: string | null, policyId: string | null, bundle: PitchBundle, parentPitchId?: string): Promise<PitchView> {
    void jobId; void policyId; void parentPitchId;
    const list = this.pitches.get(ngoId) ?? [];
    const view: PitchView = {
      id: randomUUID(), tone: bundle.tone, version: list.length + 1, scoreTotal: bundle.totalScore, status: "DRAFT", generatedBy: bundle.generatedBy, warnings: bundle.warnings, createdAt: new Date().toISOString(),
      drafts: bundle.drafts.map((d) => ({ id: randomUUID(), channel: d.channel, subject: d.subject ?? null, body: d.body, editedBody: null, status: "DRAFT", score: d.score, breakdown: { ...d.breakdown }, origin: d.origin, lint: d.lint, notes: d.notes })),
    };
    this.pitches.set(ngoId, [view, ...list]);
    return structuredClone(view);
  }
  async editDraft(draftId: string, patch: { editedBody?: string | null; status?: "DRAFT" | "APPROVED" | "REJECTED" }, actor: string) {
    for (const list of this.pitches.values()) for (const p of list) {
      const d = p.drafts.find((x) => x.id === draftId);
      if (d) {
        if (patch.editedBody !== undefined) d.editedBody = patch.editedBody;
        if (patch.status) d.status = patch.status;
        this.audit.push({ entityType: "PitchDraft", entityId: draftId, action: "edit", actor });
        return;
      }
    }
    throw new Error("draft not found");
  }
  async addEvidenceNote(ngoId: string, input: { url: string; title?: string; summary?: string }, actor: string): Promise<EvidenceView> {
    const d = this.data.get(ngoId);
    if (!d) throw new Error("ngo not found");
    const e: EvidenceDraft = { url: input.url, title: input.title, sourceType: "USER_ADDED", isOfficial: false, fetchStatus: "NOT_ATTEMPTED", summary: input.summary, confidence: "MEDIUM", checkedAt: new Date().toISOString() };
    const view = { ...e, id: randomUUID() };
    d.evidence.push(view);
    this.audit.push({ entityType: "EvidenceSource", entityId: view.id, action: "add", actor });
    return view;
  }
  async recordExport(ngoId: string, kind: string, mode: "INTERNAL" | "NGO_FACING", actor: string) { this.exports.push({ ngoId, kind, mode, actor }); }
}
