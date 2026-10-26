import { FRAMEWORK, FRAMEWORK_BY_ID, type FrameworkArea } from "./framework";
import type { Assessment, Confidence, FindingDraft, FrameworkAreaId, GapState, Priority } from "./types";

/** Which audit signals (finding keys / key prefixes) inform each framework area. */
export const AREA_SIGNALS: Record<FrameworkAreaId, string[]> = {
  brand: ["brand."],
  "website-ux": ["site.reachable", "site.https", "journey.contact", "site.broken.contact", "site.broken.about", "site.broken.reports", "site.broken.impact", "site.broken.csr", "site.broken.media", "site.broken.events", "site.broken.privacy"],
  donation: ["journey.donate", "site.broken.donate"],
  volunteer: ["journey.volunteer", "site.broken.volunteer"],
  "search-seo": ["seo.", "search."],
  "ad-grants": ["derived.ad-grants"],
  social: ["social."],
  storytelling: ["content.impact", "site.freshness"],
  "media-content": ["content.video"],
  "annual-report-design": ["content.reports"],
  credibility: ["trust.registration-claims", "trust.governance"],
  csr: ["content.csr"],
  "grants-awards": ["content.awards"],
  "pr-media": ["content.media"],
  "impact-measurement": [],
  "donor-crm": ["journey.newsletter"],
  "events-campaigns": ["content.events"],
  "staff-training": [],
  "regional-language": ["lang."],
  "privacy-consent": ["trust.privacy"],
  analytics: ["site.analytics"],
  "accessibility-mobile": ["site.viewport", "site.alt", "site.form-labels", "site.lang", "site.perf"],
};

const STATE_SEVERITY: Record<GapState, number> = { CONFIRMED_ISSUE: 4, LIKELY_OPPORTUNITY: 3, NOT_FOUND_PUBLICLY: 2, UNABLE_TO_ASSESS: 1 };
const PRIORITY_RANK: Record<Priority, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const CONF_RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export interface AreaAssessment {
  area: FrameworkArea;
  /** null = no gap evidenced (baseline looked adequate on the evidence checked). */
  gapState: GapState | null;
  assessment: Assessment;
  /** Merged, area-level GAP finding (null when no gap evidenced). */
  finding: FindingDraft | null;
  supportingKeys: string[];
}

function matches(key: string, signals: string[]) {
  return signals.some((s) => (s.endsWith(".") ? key.startsWith(s) : key === s));
}

export interface AssessContext {
  checkedAt: string;
  siteAssessable: boolean;
  https: boolean;
  hasAboutContent: boolean;
  officialSiteUrl?: string;
}

export function assessAreas(findings: FindingDraft[], ctx: AssessContext): AreaAssessment[] {
  return FRAMEWORK.map((area) => {
    const signals = AREA_SIGNALS[area.id];
    const relevant = findings.filter((f) => matches(f.key, signals));
    const gaps = relevant.filter((f) => f.section === "GAP" && f.gapState);
    const existing = relevant.filter((f) => f.section === "EXISTING");

    // Derived: Google Ad Grants — never more than a low-confidence "worth exploring".
    if (area.id === "ad-grants") {
      if (ctx.siteAssessable && ctx.https && ctx.hasAboutContent) {
        const f = synth(area, ctx, "LIKELY_OPPORTUNITY", "Google Ad Grants may be worth exploring",
          "The website is reachable over HTTPS and describes the organisation, which are prerequisites for the Google Ad Grants programme. Eligibility (Google for Nonprofits verification, programme policies) and whether an account already exists could not be established from public pages.",
          { confidence: "LOW", priority: "LOW", evidenceUrls: ctx.officialSiteUrl ? [ctx.officialSiteUrl] : [], recommendedAction: "Ask in discovery whether the NGO already uses Google for Nonprofits; verify eligibility before any proposal." });
        return { area, gapState: "LIKELY_OPPORTUNITY", assessment: "UNKNOWN", finding: f, supportingKeys: ["derived.ad-grants"] };
      }
    }

    if (!ctx.siteAssessable && area.id !== "social" && area.id !== "search-seo" && area.id !== "ad-grants") {
      const siteFinding = findings.find((f) => f.key === "site.reachable");
      const f = synth(area, ctx, "UNABLE_TO_ASSESS", `${area.title}: could not be assessed`, area.unassessable, { confidence: "HIGH", evidenceUrls: siteFinding?.evidenceUrls ?? [] });
      return { area, gapState: "UNABLE_TO_ASSESS", assessment: "UNKNOWN", finding: f, supportingKeys: [] };
    }

    if (gaps.length === 0) {
      if (existing.length === 0) {
        const f = synth(area, ctx, "UNABLE_TO_ASSESS", `${area.title}: could not be assessed`, area.unassessable, { confidence: "HIGH", evidenceUrls: [] });
        return { area, gapState: "UNABLE_TO_ASSESS", assessment: "UNKNOWN", finding: f, supportingKeys: [] };
      }
      const strong = existing.every((e) => e.assessment === "STRONG");
      return { area, gapState: null, assessment: strong ? "STRONG" : "ADEQUATE", finding: null, supportingKeys: existing.map((e) => e.key) };
    }

    const sorted = [...gaps].sort((a, b) =>
      STATE_SEVERITY[b.gapState as GapState] - STATE_SEVERITY[a.gapState as GapState] ||
      (PRIORITY_RANK[b.priority ?? "LOW"] - PRIORITY_RANK[a.priority ?? "LOW"]) ||
      CONF_RANK[b.confidence] - CONF_RANK[a.confidence]);
    const rep = sorted[0];
    const others = sorted.slice(1, 3).filter((o) => o.gapState !== "UNABLE_TO_ASSESS");
    const offlineNote = area.oftenOffline && rep.gapState !== "UNABLE_TO_ASSESS" ? " The NGO may already handle this privately or offline." : "";
    const finding: FindingDraft = {
      ...rep,
      key: `area.${area.id}`,
      areaId: area.id,
      section: "GAP",
      title: rep.title,
      observation: `${rep.observation}${others.length ? ` Also noted: ${others.map((o) => o.title.charAt(0).toLowerCase() + o.title.slice(1)).join("; ")}.` : ""}${offlineNote}`,
      evidenceUrls: [...new Set(sorted.flatMap((g) => g.evidenceUrls))],
      priority: sorted.map((g) => g.priority).filter(Boolean).sort((a, b) => PRIORITY_RANK[b as Priority] - PRIORITY_RANK[a as Priority])[0],
      whyItMatters: area.whyItMatters,
      consequence: area.consequence,
      mayAddressOffline: area.oftenOffline,
      checkedAt: ctx.checkedAt,
    };
    return { area, gapState: rep.gapState as GapState, assessment: rep.assessment, finding, supportingKeys: sorted.map((g) => g.key) };
  });
}

function synth(area: FrameworkArea, ctx: AssessContext, gapState: GapState, title: string, observation: string, o: { confidence: Confidence; priority?: Priority; evidenceUrls: string[]; recommendedAction?: string }): FindingDraft {
  return {
    key: `area.${area.id}`, areaId: area.id, section: "GAP", category: area.category, title, observation, gapState,
    assessment: "UNKNOWN", confidence: o.confidence, priority: gapState === "UNABLE_TO_ASSESS" ? undefined : o.priority,
    whyItMatters: area.whyItMatters, consequence: area.consequence, recommendedAction: o.recommendedAction,
    mayAddressOffline: area.oftenOffline, evidenceUrls: o.evidenceUrls, checkedAt: ctx.checkedAt,
  };
}

// ── ranking ────────────────────────────────────────────────────────────────

const STATE_W: Partial<Record<GapState, number>> = { CONFIRMED_ISSUE: 1, LIKELY_OPPORTUNITY: 0.8, NOT_FOUND_PUBLICLY: 0.6 };
const CONF_W: Record<Confidence, number> = { HIGH: 1, MEDIUM: 0.8, LOW: 0.55 };
const PRIO_W: Record<Priority, number> = { CRITICAL: 1, HIGH: 0.85, MEDIUM: 0.65, LOW: 0.45 };

export interface RankedOpportunity {
  areaId: FrameworkAreaId;
  score: number;
  finding: FindingDraft;
  factors: { impact: number; urgency: number; confidence: number; feasibility: number; state: number };
}

/** Rank by impact, urgency (priority), confidence and feasibility, discounted by evidence state. */
export function rankOpportunities(areas: AreaAssessment[], limit = 5): RankedOpportunity[] {
  const ranked: RankedOpportunity[] = [];
  for (const a of areas) {
    const f = a.finding;
    if (!f || !f.gapState || !(f.gapState in STATE_W)) continue;
    const impact = a.area.impact / 5;
    const feasibility = a.area.feasibility / 5;
    const urgency = PRIO_W[f.priority ?? "LOW"];
    const confidence = CONF_W[f.confidence];
    const state = STATE_W[f.gapState] as number;
    const score = (0.4 * impact + 0.2 * feasibility + 0.2 * urgency + 0.2 * confidence) * state;
    ranked.push({ areaId: a.area.id, score: Number(score.toFixed(4)), finding: f, factors: { impact, urgency, confidence, feasibility, state } });
  }
  return ranked.sort((x, y) => y.score - x.score || x.areaId.localeCompare(y.areaId)).slice(0, limit);
}

export { FRAMEWORK_BY_ID };
