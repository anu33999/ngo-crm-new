/**
 * Verifies the seeded database against the reference files' stated facts.
 * Exit code 0 = everything matches; 1 = at least one check failed.
 *
 *   npm run db:verify
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXPECTED_AREA_COUNTS: Record<string, number> = {
  DM: 29, PR: 17, PRO: 14, SEO: 20, BR: 25, AD: 24, AN: 15, LG: 19, FM: 24, TP: 12, AV: 7,
};
const EXPECTED_PRICES: Record<string, number> = { SILVER: 15000, GOLD: 25000, PLATINUM: 40000 };

type AreaRow = { code: string; name: string; _count: { services: number } };
type PackageRow = {
  tier: string;
  name: string;
  monthlyPriceInr: number;
  gstExtra: boolean;
  attributes: unknown;
  deliverables: unknown[];
  inclusions: { qualifier: string | null; service: { code: string } }[];
};
type AddOnRow = { kind: string };
type RuleRow = { eligibility: string; _count: number };

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  // ── catalogue
  const services = await prisma.serviceCatalogue.count();
  check("206 services", services === 206, `found ${services}`);

  const areas: AreaRow[] = await prisma.practiceArea.findMany({
    include: { _count: { select: { services: true } } },
    orderBy: { sortOrder: "asc" },
  });
  check("11 practice areas", areas.length === 11, `found ${areas.length}`);
  for (const a of areas) {
    const want = EXPECTED_AREA_COUNTS[a.code];
    check(`${a.code} ${a.name}`, a._count.services === want, `${a._count.services}/${want}`);
  }

  // ── packages
  const packages: PackageRow[] = await prisma.package.findMany({
    include: { inclusions: { include: { service: true } }, deliverables: true },
    orderBy: { monthlyPriceInr: "asc" },
  });
  check("3 package tiers", packages.length === 3, `found ${packages.length}`);
  for (const p of packages) {
    const want = EXPECTED_PRICES[p.tier];
    check(`${p.name} = ₹${want.toLocaleString("en-IN")}/month (excl. GST)`, p.monthlyPriceInr === want && p.gstExtra, `found ₹${p.monthlyPriceInr}`);
    check(`${p.name} has deliverables and included services`, p.deliverables.length > 0 && p.inclusions.length > 0,
      `${p.deliverables.length} deliverables, services: ${p.inclusions.map((i) => i.service.code + (i.qualifier ? ` (${i.qualifier})` : "")).join(", ")}`);
  }

  // ── add-ons
  const addOns: AddOnRow[] = await prisma.addOn.findMany({ include: { services: true } });
  check("add-ons loaded (40 rows in workbook)", addOns.length === 40, `found ${addOns.length}`);
  const byKind: Record<string, number> = {};
  for (const a of addOns) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
  console.log(`      add-on kinds: ${JSON.stringify(byKind)}`);

  // ── package eligibility derived per service
  const grouped = await prisma.policyServiceRule.groupBy({ by: ["eligibility"], _count: true, orderBy: { eligibility: "asc" } });
  const rules: RuleRow[] = grouped;
  const total = rules.reduce((n, r) => n + r._count, 0);
  check("every service has a reference-policy eligibility rule", total === 206, `${total} rules`);
  console.log(`      eligibility: ${rules.map((r) => `${r.eligibility}=${r._count}`).join(", ")}`);

  // ── pricing policy safety
  const policy = await prisma.pricingPolicy.findFirst({ where: { model: "STANDARD_PACKAGES" } });
  check("reference pricing policy is DRAFT and inactive (needs human approval)", !!policy && policy.status === "DRAFT" && !policy.isActive);

  // ── confidentiality: internal economics must not leak into client-facing package rows
  const internalRows = await prisma.packageInternalEconomics.count();
  check("internal economics stored separately (3 rows)", internalRows === 3, `found ${internalRows}`);
  const leaked = packages.filter((p) => JSON.stringify(p.attributes).toLowerCase().includes("delivery hours"));
  check("no internal delivery hours inside Package.attributes", leaked.length === 0);

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
