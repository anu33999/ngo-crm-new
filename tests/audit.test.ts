import { describe, expect, it } from "vitest";
import { extractPage } from "@/lib/research/extract";
import { auditSite } from "@/lib/research/audit";
import { DONATE_PAGE, HOME_RICH, HOME_SPARSE } from "./fixtures/html";
import { SITE, snapshotFrom } from "./helpers";

const byKey = (fs: ReturnType<typeof auditSite>, k: string) => fs.find((f) => f.key === k);

describe("page extraction", () => {
  const f = extractPage(HOME_RICH, `${SITE}/`);
  it("pulls SEO, analytics, schema, social, forms and registration mentions", () => {
    expect(f.title).toMatch(/Asha Kiran/);
    expect(f.viewport).toBeTruthy();
    expect(f.analytics).toContain("Google Analytics 4");
    expect(f.jsonLdTypes).toContain("NGO");
    expect(f.socialLinks).toHaveLength(3);
    expect(f.registrationMentions).toMatchObject({ "80G": true, "12A": true, FCRA: false });
    expect(f.keywordLinks.donate[0].href).toBe(`${SITE}/donate`);
    expect(f.keywordLinks.reports.some((l) => l.href.endsWith(".pdf"))).toBe(true);
    expect(f.keywordLinks.newsletter.length).toBeGreaterThan(0);
    expect(f.videoEmbeds).toBe(1);
    expect(f.latestYear).toBe(2025);
  });
  it("counts images without alt and unlabeled form fields", () => {
    const s = extractPage(HOME_SPARSE, `${SITE}/`);
    expect(s.images).toEqual({ total: 6, withoutAlt: 6 });
    expect(s.forms[0].labelled).toBe(false);
  });
  it("detects payment provider hints in markup", () => {
    expect(extractPage(DONATE_PAGE, `${SITE}/donate`).paymentHints).toContain("Razorpay");
  });
});

describe("website audit — rich site", () => {
  const fs = auditSite(snapshotFrom(HOME_RICH, { donateHtml: DONATE_PAGE }));
  it("finds the donation path and says the payment flow was not tested", () => {
    const d = byKey(fs, "journey.donate");
    expect(d?.section).toBe("EXISTING");
    expect(d?.observation).toMatch(/Razorpay/);
    expect(d?.observation).toMatch(/not tested/);
    expect(d?.pageUrl).toBe(`${SITE}/donate`);
  });
  it("labels registration mentions as the NGO's own claims, not verified facts", () => {
    expect(byKey(fs, "trust.registration-claims")?.observation).toMatch(/have not been verified/);
  });
  it("reports a missing sitemap as 'not found' with a hedge, not as a confirmed issue", () => {
    const s = byKey(fs, "seo.sitemap");
    expect(s?.gapState).toBe("NOT_FOUND_PUBLICLY");
    expect(s?.observation).toMatch(/may exist at another address/);
  });
  it("raises no CONFIRMED_ISSUE and no CRITICAL for a healthy site", () => {
    expect(fs.filter((f) => f.gapState === "CONFIRMED_ISSUE")).toEqual([]);
    expect(fs.filter((f) => f.priority === "CRITICAL")).toEqual([]);
  });
  it("marks performance as unable-to-assess (not scored) when PageSpeed is not configured", () => {
    const p = byKey(fs, "site.perf");
    expect(p?.gapState).toBe("UNABLE_TO_ASSESS");
    expect(p?.observation).toMatch(/PAGESPEED_API_KEY/);
  });
});

describe("website audit — sparse site", () => {
  const fs = auditSite(snapshotFrom(HOME_SPARSE));
  it("never states that a missing donation page 'does not exist'", () => {
    const d = byKey(fs, "journey.donate");
    expect(d?.gapState).toBe("NOT_FOUND_PUBLICLY");
    expect(d?.title).toBe("No donation page found in the sources checked");
    expect(d?.observation).toMatch(/may exist elsewhere/);
  });
  it("uses absence-of-evidence wording on every NOT_FOUND finding", () => {
    for (const f of fs.filter((x) => x.gapState === "NOT_FOUND_PUBLICLY")) {
      expect(`${f.title} ${f.observation}`).not.toMatch(/\b(does not have|doesn't have|has no|is missing|no donation infrastructure)\b|(?<!not mean the NGO )\blacks\b/i);
      expect(f.title).toMatch(/found/i);
    }
  });
  it("confirms only what is directly visible in the HTML", () => {
    expect(byKey(fs, "seo.basics")?.gapState).toBe("CONFIRMED_ISSUE");
    expect(byKey(fs, "site.alt")?.gapState).toBe("CONFIRMED_ISSUE");
    expect(byKey(fs, "site.viewport")?.gapState).toBe("LIKELY_OPPORTUNITY");
    expect(byKey(fs, "site.viewport")?.observation).toMatch(/not tested/);
  });
  it("gives every non-UNABLE gap finding a priority and an evidence URL", () => {
    for (const f of fs.filter((x) => x.section === "GAP" && x.gapState !== "UNABLE_TO_ASSESS")) {
      expect(f.priority).toBeTruthy();
      expect(f.evidenceUrls.length).toBeGreaterThan(0);
    }
  });
});

describe("website audit — edge cases", () => {
  it("reserves CRITICAL for plain-HTTP sites that collect data in forms", () => {
    const fs = auditSite(snapshotFrom(HOME_SPARSE, { homepage: { status: "OK", httpStatus: 200, finalUrl: "http://ashakiranfoundation.org/" } }));
    expect(byKey(fs, "site.https")).toMatchObject({ gapState: "CONFIRMED_ISSUE", priority: "CRITICAL" });
    expect(fs.filter((f) => f.priority === "CRITICAL").map((f) => f.key)).toEqual(["site.https"]);
  });

  it("an unreachable homepage yields a single 'unable to assess' finding", () => {
    const fs = auditSite(snapshotFrom(null));
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ key: "site.reachable", gapState: "UNABLE_TO_ASSESS" });
    expect(fs[0].priority).toBeUndefined();
  });

  it("a robots.txt block is explicitly not treated as a problem with the site", () => {
    const fs = auditSite(snapshotFrom(null, { homepage: { status: "BLOCKED_BY_ROBOTS", error: "disallowed by robots.txt" } }));
    expect(fs[0].observation).toMatch(/not evidence of a problem/);
  });

  it("reports a tested 404 on a linked donation page as a confirmed, high-priority broken link", () => {
    const fs = auditSite(
      snapshotFrom(HOME_RICH, {
        pages: [{ role: "donate", url: `${SITE}/donate`, linkedFrom: `${SITE}/`, fetch: { status: "FAILED", httpStatus: 404, error: "HTTP 404" } }],
      }),
    );
    const b = byKey(fs, "site.broken.donate");
    expect(b).toMatchObject({ gapState: "CONFIRMED_ISSUE", priority: "HIGH", pageUrl: `${SITE}/` });
    expect(b?.evidenceUrls).toContain(`${SITE}/donate`);
  });

  it("a donate link whose page could not be retrieved is 'unable to assess', not 'broken'", () => {
    const fs = auditSite(snapshotFrom(HOME_RICH, { pages: [{ role: "donate", url: `${SITE}/donate`, linkedFrom: SITE, fetch: { status: "TIMEOUT", error: "timed out" } }] }));
    expect(byKey(fs, "journey.donate")?.gapState).toBe("UNABLE_TO_ASSESS");
  });
});
