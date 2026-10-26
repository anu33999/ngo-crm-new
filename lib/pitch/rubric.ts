import { RUBRIC_MAX, type LintIssue, type PitchDraftOut, type PitchFacts, type RubricBreakdown, type ScoredDraft } from "./types";

/**
 * 100-point pitch rubric (heuristic — it checks measurable properties, not whether the pitch will land):
 *   Specificity 25 · Evidence 25 · Relevance 20 · Value 15 · CTA 10 · Tone 5
 * Any lint *error* caps the total at 60 so a risky draft can never look “excellent”.
 */

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)));
const includesCI = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase());

export function scoreDraft(draft: PitchDraftOut, facts: PitchFacts): ScoredDraft {
  const text = `${draft.subject ?? ""}\n${draft.body}`;
  const notes: string[] = [];
  const pts = facts.points;
  const interactive = draft.channel !== "DISCOVERY_QUESTIONS";

  // Specificity (25)
  let specificity = 0;
  if (includesCI(text, facts.ngoName)) specificity += 5; else notes.push("Does not name the NGO.");
  const referenced = pts.filter((p) => includesCI(text, p.sentence.slice(0, 40)) || includesCI(text, p.title)).length;
  specificity += referenced >= 2 ? 10 : referenced === 1 ? 6 : 0;
  if (referenced === 0 && pts.length) notes.push("Does not reference any specific observation.");
  if (facts.siteUrl && includesCI(text, facts.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""))) specificity += 5;
  if (facts.location && includesCI(text, facts.location)) specificity += 5; else if (!facts.location) specificity += 3;

  // Evidence (25)
  let evidence = 0;
  const withEvidence = pts.filter((p) => p.evidenceUrls.length > 0).length;
  evidence += pts.length ? Math.round((withEvidence / pts.length) * 10) : 5;
  const needsHedge = pts.filter((p) => p.state === "NOT_FOUND_PUBLICLY" || p.state === "LIKELY_OPPORTUNITY");
  const hedged = needsHedge.filter(() => includesCI(text, "publicly") || includesCI(text, "may ") || includesCI(text, "tell us if")).length;
  evidence += needsHedge.length ? Math.round((hedged / needsHedge.length) * 10) : 10;
  if (/public information|publicly|public website/i.test(text)) evidence += 5; else notes.push("Does not say that the observations rest on public information.");

  // Relevance (20)
  let relevance = 0;
  const withService = pts.filter((p) => p.serviceName).length;
  relevance += pts.length ? Math.round((withService / pts.length) * 10) : 5;
  const dnp = facts.doNotPitchNames.some((n) => n && includesCI(text, n));
  relevance += dnp ? 0 : 5;
  const serviceMentions = new Set(pts.filter((p) => p.serviceName && includesCI(text, p.serviceName)).map((p) => p.serviceName)).size;
  relevance += serviceMentions <= 3 ? 5 : 0;

  // Value (15)
  let value = 0;
  const benefitStated = pts.some((p) => p.benefit && (includesCI(text, p.benefit.slice(0, 30)) || /aim would be|the aim/i.test(text)));
  value += benefitStated ? 8 : draft.channel === "DISCOVERY_QUESTIONS" ? 8 : 3;
  value += /cost|fee|pricing|proposal|third-party/i.test(text) ? 7 : 2;

  // CTA (10)
  const asks = (text.match(/\b(would you be open|would a|open to|i would be grateful for|may i|could we|can we)\b/gi) ?? []).length;
  let cta = interactive ? (asks === 1 ? 10 : asks >= 2 && asks <= 3 ? 6 : asks === 0 ? 2 : 3) : 8;
  if (interactive && asks === 0) notes.push("No clear call to action.");
  if (interactive && asks > 3) notes.push("Too many separate asks.");
  if (draft.channel === "PHONE_SCRIPT" || draft.channel === "ONE_PAGE_PROPOSAL" || draft.channel === "MEETING_REQUEST") cta = Math.max(cta, 8);

  // Tone (5)
  const errors = draft.lint.filter((i: LintIssue) => i.severity === "error");
  const warnings = draft.lint.filter((i: LintIssue) => i.severity === "warning" && i.code !== "placeholder");
  const tone = clamp(5 - errors.length * 3 - warnings.length, 5);

  const breakdown: RubricBreakdown = {
    specificity: clamp(specificity, RUBRIC_MAX.specificity),
    evidence: clamp(evidence, RUBRIC_MAX.evidence),
    relevance: clamp(relevance, RUBRIC_MAX.relevance),
    value: clamp(value, RUBRIC_MAX.value),
    cta: clamp(cta, RUBRIC_MAX.cta),
    tone,
  };
  let score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  if (errors.length) {
    score = Math.min(score, 60);
    notes.push("Capped at 60 because the draft has lint errors that must be fixed.");
  }
  return { ...draft, score, breakdown, notes };
}
