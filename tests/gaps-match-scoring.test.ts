import { describe, expect, it } from "vitest";
import { auditSite } from "@/lib/research/audit";
import { assessAreas, rankOpportunities } from "@/lib/research/gaps";
import { FRAMEWORK } from "@/lib/research/framework";
import { RULES, matchServices } from "@/lib/research/match";
import { readinessScores, opportunityScore } from "@/lib/research/scoring";
import { socialFindings, discoverSocial, searchPresenceFindings } from "@/lib/research/discover";
import { assessCompliance } from "@/lib/research/compliance";
import { extractPage } from "@/lib/research/extract";
import { referenceCatalogue } from "@/lib/catalogue";
import { DONATE_PAGE, HOME_RICH, HOME_SPARSE } from "./fixtures/html";
import { CLEAR_RESULTS } from "./fixtures/search-results";
import { CHECKED_AT, SITE, snapshotFrom } from "./helpers";

const ctx = (assessable = true, https = true) => ({ checkedAt: CHECKED_AT, siteAssessable: assessable, https, hasAboutContent: true, officialSiteUrl: SITE });
const catalogue = referenceCatalogue();

function run(html: string | null, o: Parameters<typeof snapshotFrom>[1] = {}) {
  const snap = snapshotFrom(html, o);
  const audit = auditSite(snap);
  const profiles = discoverSocial({ ngoName: "Asha Kiran Foundation", siteFacts: snap.homeFacts ? [snap.homeFacts] : [], results: [] });
  const findings = [...audit, ...socialFindings(profiles, !!snap.homeFacts, CHECKED_AT)];
  const areas = assessAreas(findings, ctx(!!snap.homeFacts));
  const top = rankOpportunities(areas);
  return { snap, findings, areas, top, profiles, match: matchServices({ areas, top, catalogue }) };
}

describe("gap extraction — 22 areas", () => {
  it("always returns all 22 framework areas, each with an evidence state or 'no gap evidenced'", () => {
    const { areas } = run(HOME_SPARSE);
    expect(areas).toHaveLength(22);
    expect(areas.map((a) => a.area.id)).toEqual(FRAMEWORK.map((f) => f.id));
    for (const a of areas) expect([null, "CONFIRMED_ISSUE", "LIKELY_OPPORTUNITY", "NOT_FOUND_PUBLICLY", "UNABLE_TO_ASSESS"]).toContain(a.gapState);
  });

  it("marks areas that automation cannot see as 'unable to assess' with the honest reason", () => {
    const { areas } = run(HOME_RICH);
    const staff = areas.find((a) => a.area.id === "staff-training");
    expect(staff?.gapState).toBe("UNABLE_TO_ASSESS");
    expect(staff?.finding?.observation).toMatch(/discovery call/);
    expect(areas.find((a) => a.area.id === "impact-measurement")?.gapState).toBe("UNABLE_TO_ASSESS");
  });

  it("when the site is unreachable, website-dependent areas are 'unable to assess' — never confirmed gaps", () => {
    const { areas } = run(null);
    const dependent = areas.filter((a) => !["social", "search-seo", "ad-grants"].includes(a.area.id));
    expect(dependent.every((a) => a.gapState === "UNABLE_TO_ASSESS")).toBe(true);
    expect(dependent.every((a) => a.finding?.priority === undefined)).toBe(true);
  });

  it("a healthy donation journey produces no donation gap", () => {
    const { areas } = run(HOME_RICH, { donateHtml: DONATE_PAGE });
    expect(areas.find((a) => a.area.id === "donation")?.gapState).toBeNull();
  });

  it("surfaces social 'not found' with a hedge and never infers inactivity from inaccessibility", () => {
    const { findings } = run(HOME_SPARSE);
    const ig = findings.find((f) => f.key === "social.instagram");
    expect(ig?.gapState).toBe("NOT_FOUND_PUBLICLY");
    expect(ig?.observation).toMatch(/may have one that is not linked or not indexed/);
    const rich = run(HOME_RICH).findings;
    expect(rich.find((f) => f.key === "social.activity")?.gapState).toBe("UNABLE_TO_ASSESS");
    expect(rich.find((f) => f.key === "social.instagram")?.observation).toMatch(/not evidence of inactivity/);
  });

  it("Ad Grants is at most a low-confidence 'worth exploring', never a confirmed issue", () => {
    const f = run(HOME_RICH).areas.find((a) => a.area.id === "ad-grants")?.finding;
    expect(f).toMatchObject({ gapState: "LIKELY_OPPORTUNITY", confidence: "LOW", priority: "LOW" });
    expect(f?.observation).toMatch(/could not be established/);
  });
});

describe("top-5 opportunities", () => {
  it("ranks only evidenced gaps (never 'unable to assess'), deterministically, max 5", () => {
    const { top, areas } = run(HOME_SPARSE);
    expect(top.length).toBeLessThanOrEqual(5);
    expect(top.length).toBeGreaterThan(0);
    for (const t of top) expect(["CONFIRMED_ISSUE", "LIKELY_OPPORTUNITY", "NOT_FOUND_PUBLICLY"]).toContain(t.finding.gapState);
    expect(top.map((t) => t.score)).toEqual([...top.map((t) => t.score)].sort((a, b) => b - a));
    expect(rankOpportunities(areas).map((t) => t.areaId)).toEqual(top.map((t) => t.areaId));
  });
  it("is specific to the NGO: a healthy site and a sparse site get different lists", () => {
    const a = run(HOME_RICH, { donateHtml: DONATE_PAGE }).top.map((t) => t.areaId);
    const b = run(HOME_SPARSE).top.map((t) => t.areaId);
    expect(a).not.toEqual(b);
  });
});

describe("service matching", () => {
  it("every rule references a real catalogue code", () => {
    for (const r of RULES) expect(catalogue.byCode.has(r.code), `${r.code} missing from catalogue`).toBe(true);
  });

  it("recommendations map to real catalogue entries with matching names, eligibility and tiers", () => {
    const { match } = run(HOME_SPARSE);
    expect(match.recommendations.length).toBeGreaterThan(0);
    expect(match.recommendations.length).toBeLessThanOrEqual(10);
    for (const r of match.recommendations) {
      const svc = catalogue.byCode.get(r.serviceCode);
      expect(svc).toBeTruthy();
      expect(r.serviceName).toBe(svc?.name);
      expect(r.packageTiers).toEqual(svc?.tiers.map((t) => t.tier));
      expect(["QUICK_WIN", "CORE_IMPROVEMENT", "LONG_TERM"]).toContain(r.level);
      expect(r.successMetric.length).toBeGreaterThan(5);
    }
  });

  it("recommends the smallest useful set, not the catalogue", () => {
    const codes = new Set(run(HOME_SPARSE).match.recommendations.map((r) => r.serviceCode));
    expect(codes.size).toBeLessThan(12);
  });

  it("recommends nothing for areas that could not be assessed", () => {
    const { match } = run(null);
    expect(match.recommendations).toEqual([]);
  });

  it("flags rests-on-'not found' recommendations for confirmation with the NGO", () => {
    const { match } = run(HOME_SPARSE);
    const donation = match.recommendations.find((r) => r.areaId === "donation");
    expect(donation?.reason).toMatch(/confirm with the NGO/);
  });

  it("builds a 'what we should not pitch' list with reasons; nothing in it is also recommended", () => {
    const { match } = run(HOME_SPARSE);
    expect(match.doNotPitch.map((d) => d.serviceCode)).toEqual(expect.arrayContaining(["TP-03", "TP-06"]));
    for (const d of match.doNotPitch) {
      expect(d.level).toBe("DO_NOT_PITCH");
      expect(d.reason.length).toBeGreaterThan(20);
      expect(match.recommendations.some((r) => r.serviceCode === d.serviceCode)).toBe(false);
    }
  });

  it("Ad Grant management requires approval and is not offered as a standard price", () => {
    const { match } = run(HOME_RICH);
    const ad = match.recommendations.find((r) => r.serviceCode === "AD-01");
    if (ad) expect(ad.pricingEligibility).toBe("REQUIRES_APPROVAL");
  });
});

describe("readiness and opportunity scoring", () => {
  it("shows 'Not enough evidence' (null), never zero, when the site could not be assessed", () => {
    const { findings } = run(null);
    const r = readinessScores(findings);
    expect(r.overall).toBeNull();
    for (const c of r.categories.filter((c) => c.id !== "content_social")) {
      expect(c.score).toBeNull();
      expect(c.note).toMatch(/Not enough evidence/);
    }
  });

  it("scores a healthy site higher than a sparse one, and counts 'not found' at half weight", () => {
    const rich = readinessScores(run(HOME_RICH, { donateHtml: DONATE_PAGE }).findings);
    const sparse = readinessScores(run(HOME_SPARSE).findings);
    expect(rich.overall).not.toBeNull();
    expect(sparse.overall).not.toBeNull();
    expect(rich.overall as number).toBeGreaterThan(sparse.overall as number);
    expect(sparse.categories.find((c) => c.id === "journeys")?.note).toMatch(/half weight/);
  });

  it("opportunity score is transparent and bounded; ignores wealth/ability-to-pay entirely", () => {
    const { areas, top, match, profiles } = run(HOME_SPARSE);
    const s = opportunityScore({ areas, top, recommendations: match.recommendations, siteAssessable: true, socialLocated: profiles.filter((p) => p.url).length, identityConfidence: 0.8, evidenceCoverage: 0.9 });
    expect(s.total).toBeGreaterThan(0);
    expect(s.total).toBeLessThanOrEqual(100);
    expect(s.breakdown.reduce((a, b) => a + b.max, 0)).toBe(100);
    expect(JSON.stringify(s).toLowerCase()).not.toMatch(/wealth|budget|afford|revenue|income/);
  });
});

describe("compliance statuses", () => {
  const facts = [extractPage(HOME_RICH, `${SITE}/`)];
  it("never reports VERIFIED from the NGO's own claims; points to the official portal", () => {
    const items = assessCompliance({ ngoName: "Asha Kiran Foundation", results: [], siteFacts: facts });
    const g = items.find((i) => i.key === "80G");
    expect(g?.status).toBe("UNVERIFIED");
    expect(g?.statement).toMatch(/not been checked against the official register/);
    expect(g?.officialLookup.url).toMatch(/^https:\/\//);
    const f = items.find((i) => i.key === "FCRA");
    expect(f?.status).toBe("NOT_FOUND");
    expect(f?.statement).toMatch(/not evidence that the NGO lacks it/);
  });
  it("marks VERIFIED only when a government-registry result names the organisation", () => {
    const results = [{ url: "https://ngodarpan.gov.in/index.php/home/statewise_ngo/1/2", title: "Asha Kiran Foundation - NGO Darpan", snippet: "Asha Kiran Foundation registered on NGO Darpan, Telangana", provider: "mock" }];
    const items = assessCompliance({ ngoName: "Asha Kiran Foundation", results, siteFacts: [] });
    expect(items.find((i) => i.key === "NGO Darpan")?.status).toBe("VERIFIED");
    expect(items.find((i) => i.key === "80G")?.status).toBe("NOT_FOUND");
  });
  it("makes no ranking claims in brand-search findings", () => {
    const f = searchPresenceFindings({ ngoName: "Asha Kiran Foundation", officialDomain: "ashakiranfoundation.org", provider: "mock", results: CLEAR_RESULTS, checkedAt: CHECKED_AT });
    expect(f[0].observation).toMatch(/not Google rankings/);
    expect(searchPresenceFindings({ ngoName: "x", provider: undefined, results: [], checkedAt: CHECKED_AT })[0].gapState).toBe("UNABLE_TO_ASSESS");
  });
});
