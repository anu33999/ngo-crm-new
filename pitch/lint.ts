import { assertClientSafe, ClientSafetyError } from "@/lib/pricing/policy";
import { looksLikeInjection } from "@/lib/ai/untrusted";
import type { Channel, LintIssue, PitchFacts } from "./types";

/** Phrases that are spammy, manipulative, over-claiming or discourteous. */
export const BANNED_PHRASES: RegExp[] = [
  /hope this (email|message|note) finds you well/i,
  /\b(revolutioni[sz]e|game[- ]chang\w+|cutting[- ]edge|world[- ]class|best[- ]in[- ]class|synergy|leverage our)\b/i,
  /\bguarantee[sd]?\b/i,
  /\b\d+\s?x\b.{0,20}\b(donations?|traffic|growth|reach)\b/i,
  /\b(double|triple) your (donations?|traffic|funding)\b/i,
  /\b(act now|limited[- ]time|don'?t miss|last chance|urgent(ly)?)\b/i,
  /\byour (website|brand|site) is (bad|terrible|poor|awful|broken|failing)\b/i,
  /\byou are (failing|losing|missing out)\b/i,
  /\b(free of cost forever|100% free|no strings attached)\b/i,
];

/** Absolute claims of absence — "not found" must never be stated as "does not exist". */
const ABSOLUTE_ABSENCE: RegExp[] = [
  /\byou (do not|don'?t|dont) have\b/i,
  /\bthere (is|are) no\b/i,
  /\b(does not|doesn'?t) exist\b/i,
  /\byou (lack|never)\b/i,
  /\b(is|are) (missing|absent) (from|on) your\b/i,
];

const LIMITS: Record<Channel, number> = {
  COLD_EMAIL: 2200, WHATSAPP: 900, LINKEDIN: 700, PHONE_SCRIPT: 3500, FOLLOW_UP_EMAIL: 1500, MEETING_REQUEST: 1800, ONE_PAGE_PROPOSAL: 4200, DISCOVERY_QUESTIONS: 3000,
};

export function lintDraft(channel: Channel, body: string, facts: PitchFacts, subject?: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const text = `${subject ?? ""}\n${body}`;
  const err = (code: string, message: string) => issues.push({ severity: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ severity: "warning", code, message });

  for (const re of BANNED_PHRASES) if (re.test(text)) err("banned-phrase", `Contains discouraged or over-claiming wording (${re.source.slice(0, 40)}…).`);
  for (const re of ABSOLUTE_ABSENCE) if (re.test(text)) err("absolute-absence", "States something is absent as fact. “Not found” must be hedged: say what was checked, not that it does not exist.");
  if (looksLikeInjection(text)) err("injection-like", "Contains instruction-like text that may have come from an untrusted web page.");

  try { assertClientSafe(text); } catch (e) {
    if (e instanceof ClientSafetyError) err("internal-leak", `Mentions internal-only terms: ${e.matches.join(", ")}.`);
  }

  // price claims only if a policy was approved
  const money = text.match(/(?:₹|\bINR|\bRs\.?)\s?\d[\d,]*/gi);
  if (money && !facts.pricingApproved) err("unapproved-price", `Mentions a price (${money[0]}) but no approved pricing policy applies.`);
  if (/\b(free|no cost|no fee|pro[- ]?bono|complimentary)\b/i.test(text) && !facts.pricingApproved && channel !== "DISCOVERY_QUESTIONS") err("unapproved-free", "Says work is free/no-fee but no approved pricing policy applies.");

  // links must come from allowed evidence or Kreatif's own site
  const urls = text.match(/https?:\/\/[^\s)>\]]+/gi) ?? [];
  for (const u of urls) {
    const clean = u.replace(/[.,;]+$/, "");
    if (/kreatifatelier\.com/i.test(clean)) continue;
    if (!facts.allowedUrls.some((a) => clean.startsWith(a.replace(/\/$/, "")) || a.startsWith(clean.replace(/\/$/, "")))) err("foreign-link", `Links to ${clean}, which is not one of the evidence sources.`);
  }

  for (const n of facts.doNotPitchNames) if (n && text.toLowerCase().includes(n.toLowerCase())) err("do-not-pitch", `Mentions “${n}”, which was marked as not to be pitched.`);

  if ((text.match(/!/g) ?? []).length > 1) warn("exclamations", "Several exclamation marks read as salesy.");
  if (body.length > LIMITS[channel]) warn("too-long", `Longer than the recommended length for this channel (${body.length}/${LIMITS[channel]} characters).`);
  if (/\[\[.*?\]\]/.test(text)) warn("placeholder", "Contains a placeholder that a person must fill in or approve before sending.");
  return issues;
}

export const hasErrors = (issues: LintIssue[]) => issues.some((i) => i.severity === "error");
