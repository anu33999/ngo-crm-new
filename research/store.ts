import type { SearchResult } from "@/lib/search/types";
import type { PolicyConfig } from "@/lib/pricing/policy";
import type { PriceOverride } from "@/lib/pricing/policy";
import type { Candidate } from "./identity";
import type { Recommendation } from "./match";
import type { OpportunityScore, ReadinessCategory } from "./scoring";
import type { PitchBundle } from "@/lib/pitch/generate";
import type { Channel, Tone } from "@/lib/pitch/types";
import type { CrmNoteView, DarpanStatus, DirectoryEntry, NgoFilter, NgoPatch, NgoRecord, WebsiteStatus } from "@/lib/crm/types";
import type {
  Assessment, ComplianceItem, CoverageReport, EvidenceDraft, FindingDraft, FrameworkAreaId, GapState, SocialDraft,
} from "./types";

/**
 * Persistence boundary for the research engine. The pipeline and the API depend only on this interface;
 * `PrismaResearchStore` is the production implementation and `MemoryResearchStore` backs the tests
 * (and `RESEARCH_STORE=memory` for a throw-away local demo).
 */

export type JobStatus = "QUEUED" | "RUNNING" | "AWAITING_DISAMBIGUATION" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
export type StageId = "identify" | "discover" | "public-sources" | "audit" | "opportunities" | "match" | "pitch";

export const STAGES: { id: StageId; label: string; progress: number }[] = [
  { id: "identify", label: "Identity resolution", progress: 12 },
  { id: "discover", label: "Official site and social discovery", progress: 28 },
  { id: "public-sources", label: "Reports, news and compliance signals", progress: 46 },
  { id: "audit", label: "Technical website audit", progress: 68 },
  { id: "opportunities", label: "Evidence normalisation and gap extraction", progress: 80 },
  { id: "match", label: "Catalogue service matching", progress: 90 },
  { id: "pitch", label: "Pitch generation", progress: 100 },
];

export interface StageLogEntry {
  stage: StageId;
  status: "started" | "done" | "failed" | "skipped";
  at: string;
  note?: string;
}

export interface CandidateState {
  options: Candidate[];
  selectedKey?: string;
}

export interface JobRecord {
  id: string;
  ngoId: string | null;
  queryName: string;
  queryLocation: string | null;
  status: JobStatus;
  stage: StageId | null;
  progress: number;
  stageLog: StageLogEntry[];
  candidates: CandidateState;
  coverage: CoverageReport | null;
  attempt: number;
  isRefresh: boolean;
  parentJobId: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface NewJob {
  queryName: string;
  /** Audit an NGO that already exists (directory / CRM record) instead of creating a new one. */
  ngoId?: string;
  queryLocation?: string;
  isRefresh?: boolean;
  parentJobId?: string;
  attempt?: number;
  selectedKey?: string;
}

export type JobPatch = Partial<Pick<JobRecord, "status" | "stage" | "progress" | "stageLog" | "candidates" | "coverage" | "error" | "ngoId" | "startedAt" | "finishedAt">>;

export interface AreaSummary {
  areaId: FrameworkAreaId;
  gapState: GapState | null;
  assessment: Assessment;
  findingKey: string | null;
}

export interface AnalysisSummary {
  readiness: { overall: number | null; categories: ReadinessCategory[] };
  opportunity: OpportunityScore | null;
  areas: AreaSummary[];
  top: { areaId: FrameworkAreaId; score: number }[];
  doNotPitch: Recommendation[];
}

/** Everything the pipeline learned about one NGO in one run. */
export interface ResearchResult {
  ngoName: string;
  officialName: string;
  location?: string;
  identityStatus: "UNVERIFIED" | "AMBIGUOUS" | "CONFIRMED" | "REJECTED";
  matchSignals: string[];
  officialSite: string | null;
  officialDomain: string | null;
  identityConfidence: number;
  social: SocialDraft[];
  compliance: ComplianceItem[];
  evidence: EvidenceDraft[];
  findings: FindingDraft[];
  recommendations: Recommendation[];
  analysis: AnalysisSummary;
  coverage: CoverageReport;
  pitch: PitchBundle | null;
  pitchPolicyId: string | null;
  /** CRM write-back. Only fills blanks on the NGO record; never overwrites what a person entered. */
  crm?: {
    websiteStatus: WebsiteStatus;
    darpanStatus: DarpanStatus;
    pitchSummary: string;
    matchedServiceCodes: string[];
    contact: { phone?: string; email?: string };
  };
}

export interface EvidenceView extends EvidenceDraft { id: string }
export interface FindingView extends FindingDraft {
  id: string;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED" | "EXCLUDED";
  reviewNote: string | null;
}
export interface RecommendationView extends Recommendation {
  id: string;
  approval: "PENDING" | "APPROVED" | "REJECTED";
  priceOverride: (PriceOverride & { note?: string }) | null;
}
export interface PitchDraftView {
  id: string;
  channel: Channel;
  subject: string | null;
  body: string;
  editedBody: string | null;
  status: "DRAFT" | "APPROVED" | "REJECTED";
  score: number | null;
  breakdown: Record<string, number> | null;
  origin: "deterministic" | "ai";
  lint: { severity: "error" | "warning"; code: string; message: string }[];
  notes: string[];
}
export interface PitchView {
  id: string;
  tone: Tone;
  version: number;
  scoreTotal: number | null;
  status: "DRAFT" | "APPROVED" | "REJECTED";
  generatedBy: string;
  warnings: string[];
  createdAt: string;
  drafts: PitchDraftView[];
}

export interface NgoView {
  ngo: NgoRecord;
  identity: { officialName: string; officialWebsite: string | null; matchSignals: string[]; compliance: ComplianceItem[] } | null;
  social: (SocialDraft & { checkedAt?: string })[];
  job: JobRecord | null;
  evidence: EvidenceView[];
  findings: FindingView[];
  recommendations: RecommendationView[];
  analysis: AnalysisSummary | null;
  pitches: PitchView[];
  policy: PolicyConfig | null;
}

export interface ResearchStore {
  createJob(input: NewJob): Promise<JobRecord>;
  getJob(id: string): Promise<JobRecord | null>;
  updateJob(id: string, patch: JobPatch): Promise<JobRecord>;
  listJobs(limit: number): Promise<JobRecord[]>;
  /** A recent COMPLETED/PARTIAL job for the same query, used to avoid repeating work. */
  findCachedJob(queryName: string, queryLocation: string | undefined, maxAgeMs: number): Promise<JobRecord | null>;

  /** Search results are cached per (query) so a retry or refresh does not repeat identical provider calls. */
  getCachedSearch(query: string, maxAgeMs: number): Promise<{ provider: string; results: SearchResult[] } | null>;
  recordSearch(jobId: string, rec: { provider: string; query: string; ok: boolean; error?: string; results: SearchResult[] }): Promise<void>;

  saveResult(jobId: string, result: ResearchResult): Promise<{ ngoId: string }>;
  getActivePolicy(): Promise<PolicyConfig | null>;

  getNgoView(ngoId: string): Promise<NgoView | null>;
  deleteNgo(ngoId: string, actor: string): Promise<void>;

  // directory + CRM
  listRecords(filter?: NgoFilter): Promise<NgoRecord[]>;
  getRecord(id: string): Promise<NgoRecord | null>;
  /** Adds entries that are not already present (same name + city). Returns what was created and how many already existed. */
  /** Adds entries not already present (matched on name + city). With `fillBlanks`, an entry that matches an existing record only fills that record's EMPTY fields — nothing a person entered is overwritten. */
  upsertEntries(entries: DirectoryEntry[], actor: string, opts?: { fillBlanks?: boolean }): Promise<{ created: NgoRecord[]; existing: NgoRecord[]; updated: NgoRecord[] }>;
  updateRecord(id: string, patch: NgoPatch, actor: string): Promise<NgoRecord>;
  bulkUpdate(ids: string[], patch: NgoPatch, actor: string): Promise<NgoRecord[]>;
  listCrmNotes(ngoId: string): Promise<CrmNoteView[]>;
  addCrmNote(ngoId: string, content: string, author: string): Promise<CrmNoteView>;

  // pricing policy settings (a policy only takes effect after a named person approves it)
  listPolicies(): Promise<PolicyConfig[]>;
  savePolicy(input: Omit<PolicyConfig, "status" | "isActive" | "approvedBy">, actor: string): Promise<PolicyConfig>;
  setPolicyState(id: string, state: "APPROVE" | "RETIRE", actor: string): Promise<PolicyConfig>;

  // human review
  reviewFinding(findingId: string, patch: { reviewStatus: FindingView["reviewStatus"]; reviewNote?: string }, actor: string): Promise<void>;
  reviewRecommendation(recId: string, patch: { approval?: RecommendationView["approval"]; priceOverride?: { amountInr: number; note?: string } | null }, actor: string): Promise<void>;
  savePitch(ngoId: string, jobId: string | null, policyId: string | null, bundle: PitchBundle, parentPitchId?: string): Promise<PitchView>;
  editDraft(draftId: string, patch: { editedBody?: string | null; status?: "DRAFT" | "APPROVED" | "REJECTED" }, actor: string): Promise<void>;
  addEvidenceNote(ngoId: string, input: { url: string; title?: string; summary?: string }, actor: string): Promise<EvidenceView>;
  recordExport(ngoId: string, kind: string, mode: "INTERNAL" | "NGO_FACING", actor: string): Promise<void>;
}
