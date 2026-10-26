import type { Catalogue, Tier } from "@/lib/catalogue";
import type { Recommendation } from "@/lib/research/match";

/**
 * Pricing policy logic.
 *
 * Separates four things that must never be blurred in front of an NGO:
 *   1. subsidised professional-service scope (no professional fee, where the programme permits)
 *   2. recurring maintenance charge  (a reference tier price from the workbook, or a custom approved fee)
 *   3. one-time production / implementation charges (workbook list prices, only if the policy allows)
 *   4. third-party pass-through costs, always the NGO's
 *
 * Nothing is priced unless a person has approved an active policy. Internal economics (hours, cost per
 * hour, margins) are not reachable from this module and are rejected by `assertClientSafe`.
 */

export type PricingModelKind = "STANDARD_PACKAGES" | "SUBSIDIZED_MAINTENANCE" | "CUSTOM";

export interface PolicyConfig {
  id?: string;
  name: string;
  model: PricingModelKind;
  status: "DRAFT" | "APPROVED" | "RETIRED";
  isActive: boolean;
  approvedBy?: string | null;
  gstExtra: boolean;
  /** Third-party costs that stay with the NGO. Falls back to STANDARD_PASS_THROUGH. */
  thirdPartyCostRules?: string[];
  /** Catalogue codes whose professional work is provided at no professional fee. */
  subsidizedServiceCodes: string[];
  maintenance:
    | { mode: "NONE" }
    | { mode: "BASELINE_TIER"; tier: Tier }
    | { mode: "CUSTOM"; monthlyInr: number };
}

export const STANDARD_PASS_THROUGH = [
  "Hosting",
  "Domain registration and renewal",
  "Advertising and media spend",
  "WhatsApp Business API and message fees",
  "Payment gateway charges",
  "Paid software licences and plugins",
  "Printing, venue, travel and permissions (where applicable)",
];

export interface PricingLine {
  label: string;
  code?: string;
  amountInr: number | null;
  basis: string;
  note?: string;
}

export interface PricingSection {
  status: "APPROVED" | "NEEDS_APPROVAL";
  policyName: string | null;
  model: PricingModelKind | null;
  headline: string;
  gstNote: string;
  /** Professional work at no professional fee under the policy. */
  subsidizedScope: { code: string; name: string }[];
  monthlyMaintenance: PricingLine | null;
  oneTime: PricingLine[];
  /** Recommended work that is outside the subsidised list: needs its own approval/quote. */
  requiresSeparateApproval: { code: string; name: string }[];
  passThrough: string[];
  notes: string[];
}

export interface PriceOverride {
  amountInr: number;
  approvedBy: string;
  note?: string;
}

const fmt = (n: number) => `INR ${n.toLocaleString("en-IN")}`;
export const formatInr = fmt;

const NOT_CONFIGURED: PricingSection = {
  status: "NEEDS_APPROVAL",
  policyName: null,
  model: null,
  headline: "Pricing not configured — needs human approval before any figure or “no fee” statement is shared.",
  gstNote: "",
  subsidizedScope: [],
  monthlyMaintenance: null,
  oneTime: [],
  requiresSeparateApproval: [],
  passThrough: STANDARD_PASS_THROUGH,
  notes: ["No approved, active pricing policy exists. No price has been quoted and no work is described as free."],
};

export function buildPricingSection(args: {
  policy: PolicyConfig | null;
  recommendations: Recommendation[];
  catalogue: Catalogue;
  overrides?: Record<string, PriceOverride>;
}): PricingSection {
  const { policy, recommendations, catalogue, overrides = {} } = args;
  const usable = policy && policy.status === "APPROVED" && policy.isActive && !!policy.approvedBy;
  if (!policy || !usable) {
    return {
      ...NOT_CONFIGURED,
      policyName: policy?.name ?? null,
      model: policy?.model ?? null,
      notes: [policy ? `Policy “${policy.name}” is ${policy.status === "APPROVED" && !policy.isActive ? "approved but not active" : policy.status.toLowerCase()}; no price has been quoted.` : NOT_CONFIGURED.notes[0]],
    };
  }

  const gstNote = policy.gstExtra ? "All amounts exclude GST." : "";
  const passThrough = policy.thirdPartyCostRules?.length ? policy.thirdPartyCostRules : STANDARD_PASS_THROUGH;
  const chosen = recommendations.filter((r) => r.level !== "DO_NOT_PITCH");
  const notes: string[] = [];

  // maintenance
  let monthlyMaintenance: PricingLine | null = null;
  if (policy.maintenance.mode === "BASELINE_TIER") {
    const tier = catalogue.tiers.find((t) => t.tier === (policy.maintenance as { tier: Tier }).tier);
    if (tier) monthlyMaintenance = { label: `Monthly maintenance (${tier.name} reference price)`, amountInr: tier.monthlyPriceInr, basis: "per month", note: "Taken from the standard NGO package price list." };
  } else if (policy.maintenance.mode === "CUSTOM") {
    const amount = policy.maintenance.monthlyInr;
    if (Number.isInteger(amount) && amount > 0) monthlyMaintenance = { label: "Monthly maintenance (custom)", amountInr: amount, basis: "per month", note: `Approved by ${policy.approvedBy}.` };
  }

  const subsidizedSet = new Set(policy.subsidizedServiceCodes);
  const nameOf = (code: string) => catalogue.byCode.get(code)?.name ?? code;
  const subsidizedScope: PricingSection["subsidizedScope"] = [];
  const separate: PricingSection["requiresSeparateApproval"] = [];
  const oneTime: PricingLine[] = [];

  for (const r of chosen) {
    const svc = catalogue.byCode.get(r.serviceCode);
    if (!svc) continue;
    const override = overrides[r.serviceCode];
    if (override && Number.isInteger(override.amountInr) && override.amountInr >= 0 && override.approvedBy) {
      oneTime.push({ label: svc.name, code: svc.code, amountInr: override.amountInr, basis: r.isOngoing ? "per month" : "one-time", note: `Price set by ${override.approvedBy}${override.note ? `: ${override.note}` : ""}` });
      continue;
    }
    if (policy.model !== "STANDARD_PACKAGES" && subsidizedSet.has(svc.code)) {
      subsidizedScope.push({ code: svc.code, name: svc.name });
      continue;
    }
    if (policy.model === "STANDARD_PACKAGES") {
      if (svc.tiers.length && monthlyMaintenance === null) {
        notes.push(`${svc.name} is included in a standard monthly package; no package tier has been selected in the policy.`);
        separate.push({ code: svc.code, name: svc.name });
      } else if (svc.tiers.length) {
        // covered by the selected tier only if the tier includes the service
        const selected = policy.maintenance.mode === "BASELINE_TIER" ? policy.maintenance.tier : null;
        if (selected && svc.tiers.some((t) => t.tier === selected)) subsidizedScope.push({ code: svc.code, name: `${svc.name} (included in the ${selected.charAt(0)}${selected.slice(1).toLowerCase()} package)` });
        else if (svc.addOns[0]) oneTime.push({ label: svc.addOns[0].name, code: svc.code, amountInr: svc.addOns[0].unitPriceInr, basis: svc.addOns[0].billingBasis === "MONTHLY" ? "per month" : svc.addOns[0].billingBasis === "ONE_TIME" ? "one-time" : "per unit", note: svc.addOns[0].priceIsFrom ? "From price" : "List price" });
        else separate.push({ code: svc.code, name: svc.name });
      } else if (svc.addOns[0]) {
        oneTime.push({ label: svc.addOns[0].name, code: svc.code, amountInr: svc.addOns[0].unitPriceInr, basis: svc.addOns[0].billingBasis === "MONTHLY" ? "per month" : svc.addOns[0].billingBasis === "ONE_TIME" ? "one-time" : "per unit", note: svc.addOns[0].priceIsFrom ? "From price" : "List price" });
      } else separate.push({ code: svc.code, name: svc.name });
      continue;
    }
    separate.push({ code: svc.code, name: svc.name });
  }

  const headline =
    policy.model === "SUBSIDIZED_MAINTENANCE"
      ? "No professional service fee for the agreed scope, with a transparent monthly maintenance charge where applicable."
      : policy.model === "STANDARD_PACKAGES"
        ? "Priced from the standard NGO package list."
        : "Custom pricing approved by Kreatif Atelier.";
  if (separate.length) notes.push("Items listed under “separate approval” are outside the approved scope and are not priced here.");
  void nameOf;

  return { status: "APPROVED", policyName: policy.name, model: policy.model, headline, gstNote, subsidizedScope, monthlyMaintenance, oneTime, requiresSeparateApproval: separate, passThrough, notes };
}

/** One honest sentence about the commercial model for outreach copy. Never invents a price. */
export function offerStatement(p: PricingSection): string {
  if (p.status !== "APPROVED") {
    return "Kreatif Atelier is a digital and brand studio that supports NGOs with selected digital and communications work. If it would be useful, we would outline a specific scope in a short written proposal, including any costs, which we always set out transparently up front.";
  }
  if (p.model === "SUBSIDIZED_MAINTENANCE") {
    const fee = p.monthlyMaintenance?.amountInr != null ? ` with a transparent monthly maintenance charge of ${fmt(p.monthlyMaintenance.amountInr)}${p.gstNote ? " (excluding GST)" : ""} where applicable` : " with a transparent monthly maintenance charge where applicable";
    return `Kreatif Atelier supports NGOs with selected digital and communications services at no professional service fee for the agreed scope,${fee}. Third-party costs such as ${p.passThrough.slice(0, 4).join(", ").toLowerCase()} are separate and stay with the NGO.`;
  }
  const fee = p.monthlyMaintenance?.amountInr != null ? ` from ${fmt(p.monthlyMaintenance.amountInr)} per month${p.gstNote ? " (excluding GST)" : ""}` : "";
  return `Kreatif Atelier would set out a clear written proposal for the agreed scope${fee}, with third-party costs such as ${p.passThrough.slice(0, 4).join(", ").toLowerCase()} listed separately.`;
}

// ── client-facing safety ───────────────────────────────────────────────────

const FORBIDDEN_CLIENT_PATTERNS = [
  /internalEconomics/i, /hoursBreakdown/i, /estimatedHours/i, /estimated delivery hours/i, /delivery hours/i,
  /blendedCost/i, /cost per (productive )?hour/i, /grossContribution/i, /gross (margin|contribution)/i, /\bmargin\b/i,
  /softwareAndAssets/i, /fixedMonthlyOverhead/i, /\boverhead\b/i, /Economics sheet/i, /INTERNAL(\s|_)ONLY/i,
  /opportunityScore/i, /readinessScore/i, /prospect score/i, /internal note/i,
];

export class ClientSafetyError extends Error {
  constructor(public matches: string[]) {
    super(`Client-facing output contains internal-only content: ${matches.join(", ")}`);
  }
}

/** Throws if a client-facing value mentions internal economics, scores or notes. */
export function assertClientSafe(value: unknown): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const matches = FORBIDDEN_CLIENT_PATTERNS.filter((re) => re.test(text)).map((re) => re.source);
  if (matches.length) throw new ClientSafetyError(matches);
}
