import type { AreaAssessment, RankedOpportunity } from "./gaps";
import type { Recommendation } from "./match";
import type { FindingDraft } from "./types";

/**
 * Digital Readiness and Opportunity scores.
 *
 * Readiness measures only observable digital/communications readiness — not NGO quality or impact.
 * Evidence rules: a check that passed counts for; a CONFIRMED/LIKELY issue counts against; "not found
 * publicly" counts against at half weight (we looked where it would appear, but absence ≠ non-existence);
 * "unable to assess"/missing counts as UNKNOWN and is excluded. A category with too little known
 * evidence is reported as null ("Not enough evidence") — never as zero.
 */

export interface ReadinessCategory {
  id: string;
  label: string;
  score: number | null;
  known: number;
  total: number;
  checks: { key: string; result: "pass" | "fail" | "not-found" | "unknown"; title?: string }[];
  note: string;
  evidenceUrls: string[];
}

const CATEGORY_DEFS: { id: string; label: string; keys: string[] }[] = [
  { id: "website_conversion", label: "Website and conversion readiness", keys: ["site.https", "site.viewport", "journey.contact", "site.perf", "site.analytics"] },
  { id: "discoverability", label: "Discoverability and SEO", keys: ["seo.basics", "seo.sitemap", "seo.structured-data", "search.brand"] },
  { id: "content_social", label: "Content and social consistency", keys: ["social.instagram", "social.facebook", "social.linkedin", "social.youtube", "content.video", "site.freshness"] },
  { id: "trust", label: "Trust and transparency", keys: ["trust.registration-claims", "trust.governance", "trust.privacy", "content.reports"] },
  { id: "journeys", label: "Donation and volunteer journeys", keys: ["journey.donate", "journey.volunteer", "journey.newsletter"] },
  { id: "impact", label: "Impact reporting and measurement", keys: ["content.impact", "content.reports", "content.csr"] },
];

export const NOT_ENOUGH_EVIDENCE = "Not enough evidence";

export function readinessScores(findings: FindingDraft[]): { overall: number | null; categories: ReadinessCategory[] } {
  const byKey = new Map(findings.map((f) => [f.key, f]));
  const categories: ReadinessCategory[] = CATEGORY_DEFS.map((def) => {
    const checks = def.keys.map((key) => {
      const f = byKey.get(key);
      let result: "pass" | "fail" | "not-found" | "unknown" = "unknown";
      if (f) {
        if (f.section === "EXISTING") result = f.assessment === "UNKNOWN" ? "unknown" : "pass";
        else if (f.gapState === "CONFIRMED_ISSUE" || f.gapState === "LIKELY_OPPORTUNITY") result = "fail";
        else if (f.gapState === "NOT_FOUND_PUBLICLY") result = "not-found";
      }
      return { key, result, title: f?.title };
    });
    const pass = checks.filter((c) => c.result === "pass").length;
    const fail = checks.filter((c) => c.result === "fail").length;
    const nf = checks.filter((c) => c.result === "not-found").length;
    const known = pass + fail + nf;
    const enough = known >= 2 && known >= checks.length / 2;
    const denom = pass + fail + 0.5 * nf;
    const score = enough && denom > 0 ? Math.round((pass / (pass + fail + 0.5 * nf)) * 100) : enough ? 0 : null;
    return {
      id: def.id, label: def.label, score, known, total: checks.length, checks,
      note: enough ? `${known} of ${checks.length} checks had usable evidence${nf ? `; ${nf} “not found publicly” counted at half weight` : ""}.` : `${NOT_ENOUGH_EVIDENCE}: only ${known} of ${checks.length} checks could be assessed.`,
      evidenceUrls: [...new Set(def.keys.flatMap((k) => byKey.get(k)?.evidenceUrls ?? []))].slice(0, 6),
    };
  });
  const scored = categories.filter((c) => c.score !== null) as (ReadinessCategory & { score: number })[];
  const overall = scored.length >= 3 ? Math.round(scored.reduce((s, c) => s + c.score, 0) / scored.length) : null;
  return { overall, categories };
}

export interface OpportunityScore {
  total: number;
  breakdown: { criterion: string; points: number; max: number; reason: string }[];
}

/** Prospect prioritisation. Deliberately ignores any assumption about wealth or willingness to pay. */
export function opportunityScore(args: {
  areas: AreaAssessment[];
  top: RankedOpportunity[];
  recommendations: Recommendation[];
  siteAssessable: boolean;
  socialLocated: number;
  identityConfidence: number; // 0..1
  evidenceCoverage: number; // 0..1 share of attempted sources that succeeded
}): OpportunityScore {
  const evidenced = args.areas.filter((a) => a.finding && (a.gapState === "CONFIRMED_ISSUE" || a.gapState === "LIKELY_OPPORTUNITY"));
  const solid = evidenced.filter((a) => a.finding?.confidence !== "LOW").length;
  const gapPts = Math.min(30, solid * 6 + (evidenced.length - solid) * 2);

  const distinctServices = new Set(args.recommendations.filter((r) => r.level !== "DO_NOT_PITCH").map((r) => r.serviceCode)).size;
  const relevancePts = Math.min(25, distinctServices * 4);

  const topScore = args.top[0]?.score ?? 0;
  const benefitPts = Math.round(topScore * 15);

  const quick = args.recommendations.filter((r) => r.level === "QUICK_WIN" || r.effort === "Low").length;
  const feasPts = Math.min(10, quick * 3);

  const activityPts = (args.siteAssessable ? 6 : 0) + Math.min(4, args.socialLocated * 2);
  const confPts = Math.round(10 * Math.min(1, args.identityConfidence) * (0.5 + 0.5 * args.evidenceCoverage));

  const breakdown = [
    { criterion: "Evidence-backed digital gaps", points: gapPts, max: 30, reason: `${solid} medium/high-confidence and ${evidenced.length - solid} low-confidence evidenced gaps` },
    { criterion: "Relevance of Kreatif Atelier services", points: relevancePts, max: 25, reason: `${distinctServices} distinct catalogue services matched` },
    { criterion: "Likely benefit to the NGO", points: benefitPts, max: 15, reason: `Strongest opportunity scored ${(topScore * 100).toFixed(0)}/100 on impact, urgency, confidence and feasibility` },
    { criterion: "Feasibility of implementation", points: feasPts, max: 10, reason: `${quick} low-effort or quick-win items` },
    { criterion: "Observable signs of current activity", points: activityPts, max: 10, reason: `${args.siteAssessable ? "Website reachable" : "Website not assessable"}; ${args.socialLocated} social profile(s) located` },
    { criterion: "Research confidence", points: confPts, max: 10, reason: `Identity confidence ${(args.identityConfidence * 100).toFixed(0)}%, ${(args.evidenceCoverage * 100).toFixed(0)}% of attempted sources retrieved` },
  ];
  return { total: breakdown.reduce((s, b) => s + b.points, 0), breakdown };
}
