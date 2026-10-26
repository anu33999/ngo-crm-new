import type { RankedOpportunity } from "@/lib/research/gaps";
import type { Recommendation } from "@/lib/research/match";
import type { FindingDraft, GapState } from "@/lib/research/types";
import { sanitizeUntrusted } from "@/lib/ai/untrusted";
import { offerStatement, type PricingSection } from "@/lib/pricing/policy";
import type { PitchFacts, PitchPoint, Sender } from "./types";

const firstSentence = (t: string) => {
  const m = t.replace(/\s+/g, " ").trim().match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : t).trim();
};
const noPeriod = (t: string) => t.replace(/[.\s]+$/, "");

const HEDGE: Record<GapState, string> = {
  CONFIRMED_ISSUE: "",
  LIKELY_OPPORTUNITY: " This is based on what is publicly visible, so please tell us if we have read it wrongly",
  NOT_FOUND_PUBLICLY: " We could not find this publicly, which may simply mean we missed it or that it lives somewhere we could not see",
  UNABLE_TO_ASSESS: " We were not able to check this properly",
};

/** Turn one evidenced finding into a single, correctly hedged sentence. */
export function pointSentence(f: FindingDraft): string {
  const state = f.gapState ?? "UNABLE_TO_ASSESS";
  const obs = sanitizeUntrusted(firstSentence(f.observation), 260).text || sanitizeUntrusted(f.title, 120).text;
  return `${noPeriod(obs)}.${HEDGE[state] ? `${HEDGE[state]}.` : ""}`;
}

export interface FactsInput {
  ngoName: string;
  location?: string;
  siteUrl?: string;
  existing: FindingDraft[];
  top: Pick<RankedOpportunity, "areaId" | "score" | "finding">[];
  recommendations: Recommendation[];
  doNotPitch: Recommendation[];
  pricing: PricingSection;
  sender?: Sender;
  /** Optional: restrict points to these area ids (human toggles). */
  includeAreaIds?: string[];
  maxPoints?: number;
}

export function buildPitchFacts(input: FactsInput): PitchFacts {
  const max = input.maxPoints ?? 3;
  const recByArea = new Map<string, Recommendation>();
  for (const r of input.recommendations) if (r.level !== "DO_NOT_PITCH" && !recByArea.has(r.areaId)) recByArea.set(r.areaId, r);

  const candidates = input.top.filter((t) => !input.includeAreaIds || input.includeAreaIds.includes(t.areaId));
  // Prefer opportunities that have a matching service and real evidence; never use UNABLE_TO_ASSESS.
  const usable = candidates.filter((t) => t.finding.gapState && t.finding.gapState !== "UNABLE_TO_ASSESS" && t.finding.evidenceUrls.length > 0);
  usable.sort((a, b) => Number(recByArea.has(b.areaId)) - Number(recByArea.has(a.areaId)) || b.score - a.score);

  const points: PitchPoint[] = usable.slice(0, max).map((t) => {
    const rec = recByArea.get(t.areaId);
    const f = t.finding;
    return {
      areaId: t.areaId,
      title: sanitizeUntrusted(f.title, 120).text,
      sentence: pointSentence(f),
      state: f.gapState as GapState,
      confidence: f.confidence,
      evidenceUrls: f.evidenceUrls,
      benefit: rec?.expectedOutcome ?? "",
      serviceName: rec?.serviceName,
      serviceCode: rec?.serviceCode,
      mayAddressOffline: f.mayAddressOffline,
    };
  });

  // Positive signals worth naming: substantive things the NGO already does, not technical hygiene like "site responds".
  const STRENGTH_KEYS = ["journey.donate", "journey.volunteer", "content.reports", "content.impact", "content.csr", "content.video", "trust.registration-claims", "trust.governance", "seo.structured-data", "social.", "content.awards"];
  const strengths = input.existing.filter(
    (f) => f.section === "EXISTING" && f.assessment !== "UNKNOWN" && f.confidence === "HIGH" && f.evidenceUrls.length > 0 && STRENGTH_KEYS.some((k) => (k.endsWith(".") ? f.key.startsWith(k) : f.key === k)),
  ).slice(0, 3);
  const strength = strengths.length ? `${strengths.map((f) => noPeriod(sanitizeUntrusted(f.title, 100).text)).join("; ")}.` : undefined;

  const allowedUrls = [...new Set([input.siteUrl, ...points.flatMap((p) => p.evidenceUrls), ...strengths.flatMap((f) => f.evidenceUrls)].filter((u): u is string => !!u))];

  return {
    ngoName: sanitizeUntrusted(input.ngoName, 120).text || input.ngoName,
    location: input.location,
    siteUrl: input.siteUrl,
    strength,
    points,
    offer: offerStatement(input.pricing),
    sender: input.sender ?? { name: "[[Your name]]" },
    pricingApproved: input.pricing.status === "APPROVED",
    doNotPitchNames: input.doNotPitch.map((d) => d.serviceName),
    allowedUrls,
  };
}
