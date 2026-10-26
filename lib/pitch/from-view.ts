import type { Catalogue } from "@/lib/catalogue";
import { buildPricingSection, type PricingSection } from "@/lib/pricing/policy";
import type { NgoView } from "@/lib/research/store";
import { buildPitchFacts } from "./facts";
import type { PitchFacts, Sender } from "./types";

/**
 * Rebuild pitch facts from what is stored — so a pitch can be regenerated in another tone without re-running
 * research, and so a person's review decisions are respected:
 *  - findings a person rejected or excluded are never used;
 *  - recommendations a person rejected are not described, priced or mentioned.
 */
export function pricingFor(view: NgoView, catalogue: Catalogue): PricingSection {
  const overrides: Record<string, { amountInr: number; approvedBy: string; note?: string }> = {};
  for (const r of view.recommendations) if (r.priceOverride) overrides[r.serviceCode] = r.priceOverride;
  return buildPricingSection({ policy: view.policy, recommendations: view.recommendations.filter((r) => r.approval !== "REJECTED"), catalogue, overrides });
}

export function pitchFactsFromView(view: NgoView, catalogue: Catalogue, sender?: Sender, opts: { maxPoints?: number } = {}): { facts: PitchFacts; pricing: PricingSection } {
  const usable = view.findings.filter((f) => f.reviewStatus !== "REJECTED" && f.reviewStatus !== "EXCLUDED");
  const byKey = new Map(usable.map((f) => [f.key, f]));
  const rejectedAreas = new Set(view.recommendations.filter((r) => r.approval === "REJECTED").map((r) => r.areaId));
  const top = (view.analysis?.top ?? [])
    .map((t) => ({ areaId: t.areaId, score: t.score, finding: byKey.get(`area.${t.areaId}`) }))
    .filter((t): t is typeof t & { finding: NonNullable<typeof t.finding> } => !!t.finding && !rejectedAreas.has(t.areaId));
  const recommendations = view.recommendations.filter((r) => r.approval !== "REJECTED");
  const pricing = pricingFor(view, catalogue);
  const facts = buildPitchFacts({
    ngoName: view.identity?.officialName ?? view.ngo.name,
    location: view.ngo.location ?? undefined,
    siteUrl: view.identity?.officialWebsite ?? undefined,
    existing: usable.filter((f) => f.section === "EXISTING"),
    top,
    recommendations,
    doNotPitch: view.analysis?.doNotPitch ?? [],
    pricing,
    sender,
    maxPoints: opts.maxPoints,
  });
  return { facts, pricing };
}
