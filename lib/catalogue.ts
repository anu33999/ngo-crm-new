import catalogueJson from "../../prisma/seed-data/catalogue.json";
import packagesJson from "../../prisma/seed-data/packages.json";

export type Tier = "SILVER" | "GOLD" | "PLATINUM";
export type Eligibility = "INCLUDED_IN_PACKAGE" | "ADD_ON" | "ONE_TIME_PROJECT" | "REQUIRES_APPROVAL" | "NOT_CONFIGURED";

export interface AddOnRef {
  name: string;
  kind: "RECURRING" | "SETUP" | "PROJECT";
  unitPriceInr: number;
  priceIsFrom: boolean;
  billingBasis: "MONTHLY" | "ONE_TIME" | "PER_UNIT";
  basisNotes: string;
  thirdPartyCostNote: string | null;
  requiresEligibilityCheck: boolean;
}

export interface CatalogueService {
  code: string;
  name: string;
  practiceAreaCode: string;
  practiceAreaName: string;
  tiers: { tier: Tier; qualifier: string | null }[];
  addOns: AddOnRef[];
  eligibility: Eligibility;
}

export interface Catalogue {
  byCode: Map<string, CatalogueService>;
  tiers: { tier: Tier; name: string; monthlyPriceInr: number }[];
}

type CatalogueFile = typeof catalogueJson;
type PackagesFile = typeof packagesJson;

/** Derive eligibility exactly as prisma/seed.ts does (package > recurring add-on > setup/project > not configured). */
export function deriveEligibility(tiers: unknown[], addOns: { kind: string }[]): Eligibility {
  if (tiers.length) return "INCLUDED_IN_PACKAGE";
  if (addOns.some((a) => a.kind === "RECURRING")) return "ADD_ON";
  if (addOns.length) return "ONE_TIME_PROJECT";
  return "NOT_CONFIGURED";
}

export function buildCatalogue(cat: CatalogueFile = catalogueJson, pkgs: PackagesFile = packagesJson): Catalogue {
  const byCode = new Map<string, CatalogueService>();
  for (const area of cat.practiceAreas) {
    for (const s of area.services) {
      const tiers = (pkgs.tiers as { tier: Tier; includedServices: { code: string; qualifier: string | null }[] }[])
        .flatMap((t) => t.includedServices.filter((i) => i.code === s.code).map((i) => ({ tier: t.tier, qualifier: i.qualifier })));
      const addOns = (pkgs.addOns as (AddOnRef & { serviceCodes: string[] })[])
        .filter((a) => a.serviceCodes.includes(s.code))
        .map(({ serviceCodes: _ignored, ...rest }) => { void _ignored; return rest; });
      byCode.set(s.code, {
        code: s.code, name: s.name, practiceAreaCode: area.code, practiceAreaName: area.name,
        tiers, addOns, eligibility: deriveEligibility(tiers, addOns),
      });
    }
  }
  return {
    byCode,
    tiers: (pkgs.tiers as { tier: Tier; name: string; monthlyPriceInr: number }[]).map(({ tier, name, monthlyPriceInr }) => ({ tier, name, monthlyPriceInr })),
  };
}

let cached: Catalogue | null = null;
/** Catalogue built from the ingested reference files (same source as the DB seed). */
export function referenceCatalogue(): Catalogue {
  return (cached ??= buildCatalogue());
}
