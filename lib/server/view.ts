import { pricingFor } from "@/lib/pitch/from-view";
import type { PricingSection } from "@/lib/pricing/policy";
import type { Catalogue } from "@/lib/catalogue";
import type { NgoView } from "@/lib/research/store";

export interface NgoPayload extends NgoView {
  pricing: PricingSection;
}

export function composePayload(view: NgoView, catalogue: Catalogue): NgoPayload {
  return { ...view, pricing: pricingFor(view, catalogue) };
}
