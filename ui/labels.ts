import type { Confidence, FetchStatus, GapState, Priority, SourceType } from "@/lib/research/types";

/** The four evidence states from the research rules, in plain language. */
export const STATE_LABEL: Record<GapState, string> = {
  CONFIRMED_ISSUE: "Confirmed issue",
  LIKELY_OPPORTUNITY: "Likely opportunity",
  NOT_FOUND_PUBLICLY: "Not found publicly",
  UNABLE_TO_ASSESS: "Unable to assess",
};

export const STATE_HELP: Record<GapState, string> = {
  CONFIRMED_ISSUE: "Directly observed in a page or a tested request.",
  LIKELY_OPPORTUNITY: "Indicated by the evidence, but not directly proven.",
  NOT_FOUND_PUBLICLY: "Looked for in the places checked and not found. It may exist elsewhere.",
  UNABLE_TO_ASSESS: "Not enough accessible evidence to say. This is not a finding.",
};

export const STATE_STYLE: Record<GapState, string> = {
  CONFIRMED_ISSUE: "border-[#9b2c2c]/40 bg-[#9b2c2c]/10 text-[#8a2525] dark:text-[#e8a0a0]",
  LIKELY_OPPORTUNITY: "border-[#8a7740]/50 bg-accent/30 text-[#5d4f22] dark:text-accent",
  NOT_FOUND_PUBLICLY: "border-border bg-muted text-foreground",
  UNABLE_TO_ASSESS: "border-dashed border-border bg-transparent text-muted-foreground",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = { HIGH: "High confidence", MEDIUM: "Medium confidence", LOW: "Low confidence" };
export const PRIORITY_LABEL: Record<Priority, string> = { CRITICAL: "Critical", HIGH: "High priority", MEDIUM: "Medium priority", LOW: "Low priority" };

export const SOURCE_LABEL: Record<SourceType, string> = {
  OFFICIAL_WEBSITE: "Official website", OFFICIAL_SOCIAL: "Social profile", GOVERNMENT_REGISTRY: "Government registry", DIRECTORY: "Directory listing", NEWS: "News",
  ANNUAL_REPORT: "Report", SEARCH_RESULT: "Search result", AUDIT_TOOL: "Audit tool", USER_ADDED: "Added by team", OTHER: "Other",
};

export const FETCH_LABEL: Record<FetchStatus, string> = {
  OK: "Page retrieved", FAILED: "Could not be retrieved", BLOCKED_BY_ROBOTS: "Not retrieved: robots.txt does not allow automated access", REQUIRES_LOGIN: "Not retrieved: requires a login",
  TIMEOUT: "Not retrieved: timed out", NOT_ATTEMPTED: "Read from search result only",
};

export const LEVEL_LABEL = { QUICK_WIN: "Quick wins", CORE_IMPROVEMENT: "Core improvements", LONG_TERM: "Long-term opportunities", DO_NOT_PITCH: "Do not pitch" } as const;
export const LEVEL_HELP = {
  QUICK_WIN: "Low effort, visible result, can start straight away.",
  CORE_IMPROVEMENT: "The substantive work that closes the main gaps.",
  LONG_TERM: "Ongoing or larger programmes, worth raising once the basics work.",
} as const;

export const ELIGIBILITY_LABEL = {
  INCLUDED_IN_PACKAGE: "Part of a monthly package",
  ADD_ON: "Recurring add-on",
  ONE_TIME_PROJECT: "One-time project",
  REQUIRES_APPROVAL: "Needs approval before it is offered",
  NOT_CONFIGURED: "Pricing not configured",
} as const;

export const COMPLIANCE_LABEL = { VERIFIED: "Named in a government-registry page", UNVERIFIED: "Claimed or listed, not verified", NOT_FOUND: "Not found in sources checked", NOT_APPLICABLE: "Not applicable" } as const;

export const TONE_HELP = {
  "warm-professional": "Friendly and respectful. The default.",
  "concise-direct": "Short, specific, to the point.",
  "formal-respectful": "Formal register for trusts and institutions.",
} as const;

export function formatTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function hostOf(url: string) {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
}
export const NOT_ENOUGH = "Not enough evidence";
