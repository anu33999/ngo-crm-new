/**
 * Seeds the service catalogue, package tiers, add-ons and reference pricing policy.
 *
 * Input  : prisma/seed-data/catalogue.json + packages.json (produced by `npm run ingest`
 *          from ./reference/*.pdf and ./reference/*.xlsx).
 * Safe to re-run: every write is an upsert or a delete-and-recreate of derived rows.
 *
 * Nothing here is invented — service names/codes come from the PDF, prices/deliverables
 * from the workbook. The only authored text is the pricing-policy description, which
 * states that the policy is a DRAFT reference and needs human approval.
 */
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

// String-literal unions mirror the Prisma enums, so this file type-checks both before and
// after `prisma generate` (Prisma accepts the literal values for enum fields).
type PackageTier = "SILVER" | "GOLD" | "PLATINUM";
type AddOnKind = "RECURRING" | "SETUP" | "PROJECT";
type BillingBasis = "MONTHLY" | "ONE_TIME" | "PER_UNIT";
type PricingEligibility =
  | "INCLUDED_IN_PACKAGE"
  | "ADD_ON"
  | "ONE_TIME_PROJECT"
  | "REQUIRES_APPROVAL"
  | "NOT_CONFIGURED";

type ServiceRow = {
  id: string;
  code: string;
  packageSlots: { package: { tier: PackageTier } }[];
  addOnLinks: { addOn: { name: string; kind: AddOnKind; requiresEligibilityCheck: boolean } }[];
};

const prisma = new PrismaClient();
const DATA_DIR = path.join(__dirname, "seed-data");

type CatalogueFile = {
  practiceAreas: {
    code: string;
    name: string;
    tagline: string;
    isExpansionPractice: boolean;
    sortOrder: number;
    services: { code: string; name: string; sortOrder: number; sourcePage: number }[];
  }[];
};

type Deliverable = {
  name: string;
  quantityText: string | null;
  quantityNumeric: number | null;
  formatAndScope: string | null;
  ngoSupplies: string | null;
  workflow: string | null;
  outputMeasure: string | null;
  exclusions: string | null;
  serviceCodes: string[];
  sortOrder: number;
};

type PackagesFile = {
  policyNotes: Record<string, string>;
  tiers: {
    tier: PackageTier;
    name: string;
    monthlyPriceInr: number;
    gstExtra: boolean;
    bestFor: string;
    primaryObjective: string;
    platformsManaged: string;
    postsPerMonth: number;
    reelsPerMonth: string;
    attributes: Record<string, unknown>;
    includedServices: { code: string; qualifier: string | null }[];
    deliverables: Deliverable[];
    scopeNote: string | null;
  }[];
  addOns: {
    kind: AddOnKind;
    name: string;
    serviceCodes: string[];
    unitPriceInr: number;
    priceIsFrom: boolean;
    billingBasis: BillingBasis;
    unitLabel: string | null;
    basisNotes: string;
    percentOfSpendAlt: number | null;
    thirdPartyCostNote: string | null;
    requiresEligibilityCheck: boolean;
    sortOrder: number;
  }[];
  quoteBuilder: Record<string, unknown>;
  internalEconomics: {
    warning: string;
    assumptions: Record<string, number>;
    byTier: {
      tier: PackageTier;
      estimatedHoursTotal: number;
      hoursBreakdown: Record<string, number>;
      softwareAndAssetsInr: number;
    }[];
  };
};

function readJson<T>(file: string): T {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) {
    throw new Error(`${p} not found — run \`npm run ingest\` first.`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

const REFERENCE_POLICY_NAME = "Standard NGO packages — workbook list prices (reference)";

async function seedCatalogue(cat: CatalogueFile, pkgs: PackagesFile) {
  // Deliverables the workbook defines per service code (for ServiceCatalogue.deliverables).
  const deliverablesByCode = new Map<string, unknown[]>();
  for (const t of pkgs.tiers) {
    for (const d of t.deliverables) {
      for (const code of d.serviceCodes) {
        const list = deliverablesByCode.get(code) ?? [];
        list.push({
          tier: t.tier,
          deliverable: d.name,
          quantity: d.quantityText,
          formatAndScope: d.formatAndScope,
          exclusions: d.exclusions,
        });
        deliverablesByCode.set(code, list);
      }
    }
  }

  for (const area of cat.practiceAreas) {
    const pa = await prisma.practiceArea.upsert({
      where: { code: area.code },
      update: {
        name: area.name,
        tagline: area.tagline,
        isExpansionPractice: area.isExpansionPractice,
        sortOrder: area.sortOrder,
      },
      create: {
        code: area.code,
        name: area.name,
        tagline: area.tagline,
        isExpansionPractice: area.isExpansionPractice,
        sortOrder: area.sortOrder,
      },
    });
    for (const s of area.services) {
      const deliverables = (deliverablesByCode.get(s.code) ?? []) as object[];
      await prisma.serviceCatalogue.upsert({
        where: { code: s.code },
        update: {
          name: s.name,
          practiceAreaId: pa.id,
          sortOrder: s.sortOrder,
          sourcePage: s.sourcePage,
          deliverables,
        },
        create: {
          code: s.code,
          name: s.name,
          practiceAreaId: pa.id,
          sortOrder: s.sortOrder,
          sourcePage: s.sourcePage,
          deliverables,
        },
      });
    }
  }
}

async function seedPackages(pkgs: PackagesFile) {
  const services: { id: string; code: string }[] = await prisma.serviceCatalogue.findMany({ select: { id: true, code: true } });
  const idByCode = new Map(services.map((s) => [s.code, s.id]));
  const need = (code: string) => {
    const id = idByCode.get(code);
    if (!id) throw new Error(`Unknown catalogue code referenced by workbook: ${code}`);
    return id;
  };

  for (const t of pkgs.tiers) {
    const pkg = await prisma.package.upsert({
      where: { tier: t.tier },
      update: {
        name: t.name,
        monthlyPriceInr: t.monthlyPriceInr,
        gstExtra: t.gstExtra,
        bestFor: t.bestFor,
        primaryObjective: t.primaryObjective,
        platformsManaged: t.platformsManaged,
        postsPerMonth: t.postsPerMonth,
        reelsPerMonth: t.reelsPerMonth,
        attributes: t.attributes as object,
        scopeNote: t.scopeNote,
      },
      create: {
        tier: t.tier,
        name: t.name,
        monthlyPriceInr: t.monthlyPriceInr,
        gstExtra: t.gstExtra,
        bestFor: t.bestFor,
        primaryObjective: t.primaryObjective,
        platformsManaged: t.platformsManaged,
        postsPerMonth: t.postsPerMonth,
        reelsPerMonth: t.reelsPerMonth,
        attributes: t.attributes as object,
        scopeNote: t.scopeNote,
      },
    });

    await prisma.packageInclusion.deleteMany({ where: { packageId: pkg.id } });
    await prisma.packageInclusion.createMany({
      data: t.includedServices.map((i) => ({
        packageId: pkg.id,
        serviceId: need(i.code),
        qualifier: i.qualifier,
      })),
    });

    await prisma.packageDeliverable.deleteMany({ where: { packageId: pkg.id } });
    await prisma.packageDeliverable.createMany({
      data: t.deliverables.map((d) => ({
        packageId: pkg.id,
        name: d.name,
        quantityText: d.quantityText,
        quantityNumeric: d.quantityNumeric,
        formatAndScope: d.formatAndScope,
        ngoSupplies: d.ngoSupplies,
        workflow: d.workflow,
        outputMeasure: d.outputMeasure,
        exclusions: d.exclusions,
        serviceCodes: d.serviceCodes,
        sortOrder: d.sortOrder,
      })),
    });

    // INTERNAL ONLY — kept out of Package / Package.attributes on purpose.
    const econ = pkgs.internalEconomics.byTier.find((e) => e.tier === t.tier);
    if (!econ) throw new Error(`No internal economics row for ${t.tier}`);
    await prisma.packageInternalEconomics.upsert({
      where: { packageId: pkg.id },
      update: {
        estimatedHoursTotal: econ.estimatedHoursTotal,
        hoursBreakdown: econ.hoursBreakdown,
        softwareAndAssetsInr: econ.softwareAndAssetsInr,
      },
      create: {
        packageId: pkg.id,
        estimatedHoursTotal: econ.estimatedHoursTotal,
        hoursBreakdown: econ.hoursBreakdown,
        softwareAndAssetsInr: econ.softwareAndAssetsInr,
      },
    });
  }

  for (const [key, valueNum] of Object.entries(pkgs.internalEconomics.assumptions)) {
    await prisma.internalAssumption.upsert({
      where: { key },
      update: { valueNum, note: pkgs.internalEconomics.warning },
      create: { key, valueNum, note: pkgs.internalEconomics.warning },
    });
  }

  // Add-ons have no natural unique key in the workbook, so rebuild them deterministically.
  await prisma.addOnService.deleteMany({});
  await prisma.addOn.deleteMany({});
  for (const a of pkgs.addOns) {
    const created = await prisma.addOn.create({
      data: {
        kind: a.kind,
        name: a.name,
        unitPriceInr: a.unitPriceInr,
        priceIsFrom: a.priceIsFrom,
        billingBasis: a.billingBasis,
        unitLabel: a.unitLabel,
        basisNotes: a.basisNotes,
        percentOfSpendAlt: a.percentOfSpendAlt,
        thirdPartyCostNote: a.thirdPartyCostNote,
        requiresEligibilityCheck: a.requiresEligibilityCheck,
        sortOrder: a.sortOrder,
      },
    });
    if (a.serviceCodes.length) {
      await prisma.addOnService.createMany({
        data: a.serviceCodes.map((c) => ({ addOnId: created.id, serviceId: need(c) })),
      });
    }
  }
}

async function seedReferencePolicy(pkgs: PackagesFile) {
  // The sheet's own list of costs that are funded by the NGO (Quote builder footnote).
  const thirdPartyCostRules = [
    "Media / ad spend",
    "WhatsApp message fees",
    "Printing",
    "Venue",
    "Travel",
    "Flight (drone) permissions",
    "Hosting",
    "Software licences",
  ];

  const policy = await prisma.pricingPolicy.upsert({
    where: { name: REFERENCE_POLICY_NAME },
    update: {},
    create: {
      name: REFERENCE_POLICY_NAME,
      model: "STANDARD_PACKAGES",
      status: "DRAFT",
      isActive: false,
      description:
        "Reference copy of the monthly package list prices in NGO_Packages_Kreatif_Atelier.xlsx (excl. GST). " +
        "These are standard package prices, not a promise of free NGO services. The planned NGO support model " +
        "(subsidized / maintenance-only) is a separate policy that has not been configured; until a policy is " +
        "approved by a person, proposals must mark pricing as 'needs human approval'.",
      gstExtra: true,
      thirdPartyCostRules,
      config: {
        source: "NGO_Packages_Kreatif_Atelier.xlsx",
        notes: pkgs.policyNotes,
        quoteBuilder: pkgs.quoteBuilder as Prisma.InputJsonObject,
        discountRule: "Discount by removing scope, never by cutting the rate.",
      },
    },
  });

  // Derive each service's eligibility under this policy from the workbook.
  const services: ServiceRow[] = await prisma.serviceCatalogue.findMany({
    include: {
      packageSlots: { include: { package: true } },
      addOnLinks: { include: { addOn: true } },
    },
  });

  await prisma.policyServiceRule.deleteMany({ where: { policyId: policy.id } });
  await prisma.policyServiceRule.createMany({
    data: services.map((s) => {
      const tiers = s.packageSlots.map((p) => p.package.tier);
      const kinds = s.addOnLinks.map((l) => l.addOn.kind);
      let eligibility: PricingEligibility = "NOT_CONFIGURED";
      let note: string | null = "Not defined in the package workbook.";
      if (tiers.length) {
        eligibility = "INCLUDED_IN_PACKAGE";
        note = s.addOnLinks.length
          ? `Also sold as add-on: ${s.addOnLinks.map((l) => l.addOn.name).join("; ")}`
          : null;
      } else if (kinds.includes("RECURRING")) {
        eligibility = "ADD_ON";
        note = s.addOnLinks.map((l) => l.addOn.name).join("; ");
      } else if (kinds.length) {
        eligibility = "ONE_TIME_PROJECT";
        note = s.addOnLinks.map((l) => l.addOn.name).join("; ");
      }
      const eligCheck = s.addOnLinks.find((l) => l.addOn.requiresEligibilityCheck);
      if (eligCheck) note = `${note ?? ""} — workbook: verify eligibility/policy compliance before selling`.trim();
      return {
        policyId: policy.id,
        serviceId: s.id,
        eligibility,
        tiers: tiers,
        note,
      };
    }),
  });
}

/**
 * Hyderabad & Secunderabad starter directory (28 organisations from public NGO Darpan listing pages + 248 from the team spreadsheet).
 * Goes through the same store the app uses, so it is idempotent (matched on name + city) and never overwrites
 * anything a person has since edited. No phone numbers or websites are invented: those stay blank until a Deep Audit.
 */
async function seedTwinCityDirectory() {
  const { PrismaResearchStore } = await import("../src/lib/research/prisma-store");
  const { starterEntries } = await import("../src/lib/crm/directory");
  const { created, existing } = await new PrismaResearchStore().upsertEntries(starterEntries(), "seed", { fillBlanks: true });
  console.log(`Directory: ${created.length} Hyderabad/Secunderabad NGOs added, ${existing.length} already present.`);
}

async function main() {
  const cat = readJson<CatalogueFile>("catalogue.json");
  const pkgs = readJson<PackagesFile>("packages.json");

  await seedCatalogue(cat, pkgs);
  await seedPackages(pkgs);
  await seedReferencePolicy(pkgs);
  await seedTwinCityDirectory();

  const [areas, services, packages, addOns, rules] = await Promise.all([
    prisma.practiceArea.count(),
    prisma.serviceCatalogue.count(),
    prisma.package.count(),
    prisma.addOn.count(),
    prisma.policyServiceRule.count(),
  ]);
  console.log(
    `Seeded: ${areas} practice areas, ${services} services, ${packages} package tiers, ` +
      `${addOns} add-ons, ${rules} reference policy rules.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
