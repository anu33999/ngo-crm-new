export type GapState = "CONFIRMED_ISSUE" | "LIKELY_OPPORTUNITY" | "NOT_FOUND_PUBLICLY" | "UNABLE_TO_ASSESS";
export type Assessment = "STRONG" | "ADEQUATE" | "NEEDS_IMPROVEMENT" | "UNKNOWN";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type FindingSection = "EXISTING" | "GAP";
export type FindingCategory =
  | "WEBSITE" | "SEO" | "SOCIAL" | "COMPLIANCE" | "COMMUNICATIONS" | "BRAND" | "DONATION_VOLUNTEER"
  | "IMPACT_REPORTING" | "CONTENT_MEDIA" | "ANALYTICS" | "PRIVACY_ACCESSIBILITY" | "OTHER";
export type SourceType =
  | "OFFICIAL_WEBSITE" | "OFFICIAL_SOCIAL" | "GOVERNMENT_REGISTRY" | "DIRECTORY" | "NEWS" | "ANNUAL_REPORT"
  | "SEARCH_RESULT" | "AUDIT_TOOL" | "USER_ADDED" | "OTHER";
export type FetchStatus = "OK" | "FAILED" | "BLOCKED_BY_ROBOTS" | "REQUIRES_LOGIN" | "TIMEOUT" | "NOT_ATTEMPTED";

export type FrameworkAreaId =
  | "brand" | "website-ux" | "donation" | "volunteer" | "search-seo" | "ad-grants" | "social" | "storytelling"
  | "media-content" | "annual-report-design" | "credibility" | "csr" | "grants-awards" | "pr-media"
  | "impact-measurement" | "donor-crm" | "events-campaigns" | "staff-training" | "regional-language"
  | "privacy-consent" | "analytics" | "accessibility-mobile";

/** A finding before it is persisted. `evidenceUrls` must each exist in the job's evidence list. */
export interface FindingDraft {
  key: string; // stable signal id, e.g. "journey.donate"
  areaId: FrameworkAreaId;
  section: FindingSection;
  category: FindingCategory;
  title: string;
  observation: string;
  /** Undefined for EXISTING findings. */
  gapState?: GapState;
  assessment: Assessment;
  confidence: Confidence;
  priority?: Priority;
  whyItMatters?: string;
  consequence?: string;
  recommendedAction?: string;
  mayAddressOffline: boolean;
  pageUrl?: string;
  evidenceUrls: string[];
  checkedAt: string;
}

export interface EvidenceDraft {
  url: string;
  title?: string;
  sourceType: SourceType;
  isOfficial: boolean;
  fetchStatus: FetchStatus;
  httpStatus?: number;
  failureReason?: string;
  snapshot?: string; // minimal excerpt only
  summary?: string;
  excerpt?: string;
  confidence: Confidence;
  publishedAt?: string;
  checkedAt: string;
}

export type ComplianceKey = "80G" | "12A" | "FCRA" | "CSR-1" | "NGO Darpan";
export type ComplianceStatus = "NOT_APPLICABLE" | "VERIFIED" | "UNVERIFIED" | "NOT_FOUND";

export interface ComplianceItem {
  key: ComplianceKey;
  status: ComplianceStatus;
  /** Plain-language statement of exactly what was and was not established. */
  statement: string;
  evidenceUrls: string[];
  /** Official portal the team can use to verify manually — we do not claim to have queried it. */
  officialLookup: { name: string; url: string };
}

export interface SocialDraft {
  platform: "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "YOUTUBE" | "X" | "OTHER";
  url: string | null;
  accessState: "ACCESSIBLE" | "NOT_LOCATED" | "INACCESSIBLE";
  isOfficial: boolean;
  basis: string;
}

export interface CoverageEntry {
  category: string;
  attempted: number;
  succeeded: number;
  failed: number;
  notes: string[];
}

export interface CoverageReport {
  checkedAt: string;
  categories: CoverageEntry[];
  pagesReviewed: number;
  officialSources: number;
  thirdPartySources: number;
  failures: { url: string; status: string; reason?: string }[];
  limitations: string[];
}
