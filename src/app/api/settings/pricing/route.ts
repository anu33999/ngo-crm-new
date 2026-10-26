import { actorOf, handle, HttpError, json, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import type { PolicyConfig, PricingModelKind } from "@/lib/pricing/policy";
import type { Tier } from "@/lib/catalogue";

const MODELS: PricingModelKind[] = ["STANDARD_PACKAGES", "SUBSIDIZED_MAINTENANCE", "CUSTOM"];
const TIERS: Tier[] = ["SILVER", "GOLD", "PLATINUM"];

/** Policies, plus what the editor needs: services (for the subsidised list) and the workbook's package tiers. */
export async function GET() {
  return handle(async () => {
    const { store, catalogue } = getDeps();
    return json({
      policies: await store.listPolicies(),
      active: await store.getActivePolicy(),
      tiers: catalogue.tiers,
      services: [...catalogue.byCode.values()].map((s) => ({ code: s.code, name: s.name, practiceArea: s.practiceAreaName, eligibility: s.eligibility })),
    });
  });
}

function parsePolicy(b: Record<string, unknown>, catalogueCodes: Set<string>): Omit<PolicyConfig, "status" | "isActive" | "approvedBy"> {
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 2 || name.length > 80) throw new HttpError(400, "Give the policy a name (2–80 characters).");
  if (!MODELS.includes(b.model as PricingModelKind)) throw new HttpError(400, "Choose a pricing model.");
  const codes = Array.isArray(b.subsidizedServiceCodes) ? b.subsidizedServiceCodes : [];
  if (codes.length > 300 || !codes.every((c) => typeof c === "string" && catalogueCodes.has(c))) throw new HttpError(400, "One of the subsidised services is not in the catalogue.");
  const rules = Array.isArray(b.thirdPartyCostRules) ? b.thirdPartyCostRules : [];
  if (rules.length > 30 || !rules.every((r) => typeof r === "string" && r.trim().length > 0 && r.length <= 200)) throw new HttpError(400, "Third-party cost rules must be short lines of text.");
  const m = (b.maintenance ?? { mode: "NONE" }) as { mode?: string; tier?: string; monthlyInr?: unknown };
  let maintenance: PolicyConfig["maintenance"];
  if (m.mode === "NONE") maintenance = { mode: "NONE" };
  else if (m.mode === "BASELINE_TIER") {
    if (!TIERS.includes(m.tier as Tier)) throw new HttpError(400, "Choose a package tier for the maintenance reference.");
    maintenance = { mode: "BASELINE_TIER", tier: m.tier as Tier };
  } else if (m.mode === "CUSTOM") {
    if (typeof m.monthlyInr !== "number" || !Number.isInteger(m.monthlyInr) || m.monthlyInr < 0 || m.monthlyInr > 10_000_000) throw new HttpError(400, "Enter the monthly maintenance charge as a whole number of rupees.");
    maintenance = { mode: "CUSTOM", monthlyInr: m.monthlyInr };
  } else throw new HttpError(400, "Choose how maintenance is charged.");
  return {
    id: typeof b.id === "string" ? b.id : undefined, name, model: b.model as PricingModelKind, gstExtra: b.gstExtra !== false,
    thirdPartyCostRules: rules.map((r) => String(r).trim()), subsidizedServiceCodes: [...new Set(codes as string[])], maintenance,
  };
}

/** Save a policy as a DRAFT. Saving never activates it: a person must approve it. */
export async function POST(req: Request) {
  return handle(async () => {
    const { store, catalogue } = getDeps();
    const input = parsePolicy(await readJson(req), new Set(catalogue.byCode.keys()));
    return json({ policy: await store.savePolicy(input, actorOf(req)) }, 201);
  });
}

/** Approve (activate) or retire a policy. Approval is recorded with the approver's name. */
export async function PATCH(req: Request) {
  return handle(async () => {
    const b = await readJson<{ id?: unknown; state?: unknown }>(req);
    if (typeof b.id !== "string" || (b.state !== "APPROVE" && b.state !== "RETIRE")) throw new HttpError(400, "Provide a policy id and APPROVE or RETIRE.");
    try {
      return json({ policy: await getDeps().store.setPolicyState(b.id, b.state, actorOf(req)) });
    } catch (e) {
      if (e instanceof Error && /not found|No record/i.test(e.message)) throw new HttpError(404, "Policy not found.");
      throw e;
    }
  });
}
