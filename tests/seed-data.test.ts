import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Engine-free tests of the ingested seed data (no database needed).
 * These guard the contract between ./reference/* and prisma/seed.ts.
 */
const dir = path.join(__dirname, "..", "prisma", "seed-data");
const catalogue = JSON.parse(fs.readFileSync(path.join(dir, "catalogue.json"), "utf8"));
const packages = JSON.parse(fs.readFileSync(path.join(dir, "packages.json"), "utf8"));

type Svc = { code: string; name: string; sortOrder: number; sourcePage: number };
type Included = { code: string; qualifier: string | null };
type Deliverable = { name: string; serviceCodes: string[] };
type Tier = {
  tier: string;
  monthlyPriceInr: number;
  gstExtra: boolean;
  includedServices: Included[];
  deliverables: Deliverable[];
  attributes: Record<string, unknown>;
};
type AddOn = { name: string; kind: string; unitPriceInr: number; priceIsFrom: boolean; requiresEligibilityCheck: boolean; serviceCodes: string[] };
type Econ = { estimatedHoursTotal: number };
const areas: { code: string; name: string; services: Svc[]; isExpansionPractice: boolean }[] = catalogue.practiceAreas;
const allServices = areas.flatMap((a) => a.services);
const codeSet = new Set(allServices.map((s) => s.code));

describe("service catalogue", () => {
  it("has exactly 206 services across 11 practice areas", () => {
    expect(areas).toHaveLength(11);
    expect(allServices).toHaveLength(206);
    expect(codeSet.size).toBe(206);
  });

  it("matches the per-area counts printed on the PDF contents page", () => {
    const counts = Object.fromEntries(areas.map((a) => [a.code, a.services.length]));
    expect(counts).toEqual({ DM: 29, PR: 17, PRO: 14, SEO: 20, BR: 25, AD: 24, AN: 15, LG: 19, FM: 24, TP: 12, AV: 7 });
  });

  it("uses stable, well-formed codes with non-empty names", () => {
    for (const a of areas) {
      a.services.forEach((s, i) => {
        expect(s.code).toBe(`${a.code}-${String(i + 1).padStart(2, "0")}`);
        expect(s.name.trim().length).toBeGreaterThan(2);
      });
    }
  });

  it("preserves original names for wrapped / long entries", () => {
    const byCode = Object.fromEntries(allServices.map((s) => [s.code, s.name]));
    expect(byCode["PR-02"]).toBe("Press Release Writing & Distribution");
    expect(byCode["PRO-07"]).toBe("Trade Show & Exhibition Management");
    expect(byCode["SEO-04"]).toBe("Local SEO & Google Business Profile");
  });

  it("flags TP and AV as expansion practices, as the PDF note states", () => {
    expect(areas.filter((a) => a.isExpansionPractice).map((a) => a.code).sort()).toEqual(["AV", "TP"]);
  });
});

describe("NGO packages", () => {
  const tiers: Tier[] = packages.tiers;
  const byTier = Object.fromEntries(tiers.map((t) => [t.tier, t]));

  it("has Silver ₹15,000, Gold ₹25,000, Platinum ₹40,000 per month excl. GST", () => {
    expect(tiers.map((t) => t.tier)).toEqual(["SILVER", "GOLD", "PLATINUM"]);
    expect(byTier.SILVER.monthlyPriceInr).toBe(15000);
    expect(byTier.GOLD.monthlyPriceInr).toBe(25000);
    expect(byTier.PLATINUM.monthlyPriceInr).toBe(40000);
    expect(tiers.every((t) => t.gstExtra === true)).toBe(true);
  });

  it("only references service codes that exist in the catalogue", () => {
    for (const t of tiers) {
      for (const i of t.includedServices) expect(codeSet.has(i.code)).toBe(true);
      for (const d of t.deliverables) for (const c of d.serviceCodes) expect(codeSet.has(c)).toBe(true);
    }
    for (const a of packages.addOns as AddOn[]) for (const c of a.serviceCodes) expect(codeSet.has(c)).toBe(true);
  });

  it("keeps the workbook qualifiers (light / limited) on included services", () => {
    const q = (tier: string, code: string) => byTier[tier].includedServices.find((i) => i.code === code)?.qualifier;
    expect(q("GOLD", "SEO-02")).toBe("light");
    expect(q("SILVER", "FM-24")).toBe("limited");
    expect(q("PLATINUM", "SEO-02")).toBeNull();
  });

  it("includes the 40 add-on/setup/project rows with numeric prices", () => {
    expect(packages.addOns).toHaveLength(40);
    for (const a of packages.addOns as AddOn[]) {
      expect(Number.isInteger(a.unitPriceInr)).toBe(true);
      expect(a.unitPriceInr).toBeGreaterThan(0);
    }
    const adGrant = (packages.addOns as AddOn[]).find((a) => a.name === "Google Ad Grant management");
    expect(adGrant).toMatchObject({ unitPriceInr: 12000, kind: "RECURRING", requiresEligibilityCheck: true });
    const mobileApp = (packages.addOns as AddOn[]).find((a) => a.name === "Mobile app development");
    expect(mobileApp?.priceIsFrom).toBe(true);
  });

  it("keeps internal delivery economics out of client-facing tier data", () => {
    for (const t of tiers) {
      expect(JSON.stringify(t).toLowerCase()).not.toContain("delivery hours");
      expect(t.attributes).not.toHaveProperty("Estimated delivery hours per month");
    }
    expect(packages.internalEconomics.visibility).toBe("INTERNAL_ONLY");
    expect(packages.internalEconomics.byTier).toHaveLength(3);
    expect((packages.internalEconomics.byTier as Econ[]).map((e) => e.estimatedHoursTotal)).toEqual([9.45, 22.8, 38.25]);
  });
});
