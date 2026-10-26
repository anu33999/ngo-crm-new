import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { referenceCatalogue } from "@/lib/catalogue";
import { emptyProfile, type NgoRecord } from "@/lib/crm/types";
import { CRM_COLUMNS, csvSafe, toCsv, toPdf, toXlsx } from "@/lib/export/crm";
import { ExportBlocked, internalReport, modelToPdf, ngoFacingReport, proposalDoc } from "@/lib/export/ngo";
import { MemoryResearchStore } from "@/lib/research/memory-store";
import type { PipelineDeps, SearchLike } from "@/lib/research/pipeline";
import { runPipeline } from "@/lib/research/pipeline";
import { buildPricingSection, type PolicyConfig } from "@/lib/pricing/policy";
import { canonicalUrl } from "@/lib/search/normalize";
import { CLEAR_RESULTS } from "./fixtures/search-results";
import { DONATE_PAGE, HOME_RICH } from "./fixtures/html";

const NOW = "2026-10-21T08:00:00.000Z";

function rec(over: Partial<NgoRecord> = {}): NgoRecord {
  return {
    ...emptyProfile(), meetingScheduled: false, meetingAt: null,
    id: "r1", name: "Alpha Trust", location: "Banjara Hills, Hyderabad", city: "Hyderabad", area: "Banjara Hills", address: "Road 10", latitude: 17.41, longitude: 78.44, geoBasis: "area centroid (approximate)",
    cause: "Education & Literacy", website: null, phone: "+91 98765 43210", email: null, darpanId: "U85100TG2019NPL136503", darpanStatus: "VERIFIED", sourceNote: "NGO Darpan listing", source: "STARTER",
    contactStatus: "CONTACTED", interestStatus: "INTERESTED", inCrm: true, notes: "Warm lead", followUpAt: null, contactedAt: NOW, pitchSummary: "Line one.\nLine two.", matchedServiceCodes: ["TP-02", "SEO-01"],
    audited: true, websiteStatus: "REACHABLE", identityStatus: "CONFIRMED", lastResearchedAt: NOW, readinessScore: 62, opportunityScore: 71, latestJobId: "j1", noteCount: 2, createdAt: NOW, updatedAt: NOW, ...over,
  };
}

describe("CRM exports", () => {
  it("csvSafe neutralises formula injection but leaves ordinary numbers and text alone", () => {
    expect(csvSafe("=HYPERLINK(\"http://evil\")")).toBe("'=HYPERLINK(\"http://evil\")");
    expect(csvSafe("+cmd|' /C calc'!A0")).toMatch(/^'\+/);
    expect(csvSafe("-2+3")).toMatch(/^'-/);
    expect(csvSafe("@SUM(A1)")).toMatch(/^'@/);
    expect(csvSafe("\tfoo")).toMatch(/^'\t/);
    expect(csvSafe("+91 98765 43210")).toMatch(/^'|^\+91/); // phone numbers are either kept or guarded, never executed
    expect(csvSafe("-12")).toBe("-12");
    expect(csvSafe("Hello")).toBe("Hello");
    expect(csvSafe(null)).toBe("");
    expect(csvSafe(0)).toBe("0");
  });

  it("toCsv has a BOM, one header row, quotes embedded commas/newlines/quotes, and guards injected cells", () => {
    const csv = toCsv([rec({ name: "=BAD(), \"Quoted\" Trust", notes: "line1\nline2" }), rec({ id: "r2", name: "Plain" })]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const body = csv.slice(1);
    expect(body.split("\r\n")[0]).toBe(CRM_COLUMNS.map((c) => c.header).join(","));
    expect(body).toContain("\"'=BAD(), \"\"Quoted\"\" Trust\"");
    expect(body).toContain("\"line1\nline2\"");
    expect(body).toContain("Not found publicly"); // missing website is never blank or "none"
  });

  it("includes internal scores in the internal CRM export (and marks it so)", async () => {
    const csv = toCsv([rec()]);
    expect(csv).toContain("Digital readiness (internal)");
    const buf = await toXlsx([rec()], NOW);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Outreach CRM")!;
    expect(String(ws.getRow(1).getCell(1).value)).toMatch(/internal/i);
    expect(ws.rowCount).toBe(4);
    const headers = CRM_COLUMNS.map((_, i) => String(ws.getRow(3).getCell(i + 1).value));
    expect(headers).toEqual(CRM_COLUMNS.map((c) => c.header));
    expect(String(ws.getRow(4).getCell(1).value)).toBe("Alpha Trust");
  });

  it("xlsx writes hostile text as plain text, never as a formula", async () => {
    const buf = await toXlsx([rec({ name: "=1+1", notes: "@cmd" })], NOW);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const cell = wb.getWorksheet("Outreach CRM")!.getRow(4).getCell(1);
    expect(typeof cell.value).toBe("string");
    expect(cell.formula).toBeUndefined();
    expect(String(cell.value).startsWith("'")).toBe(true);
  });

  it("produces a real PDF", async () => {
    const pdf = await toPdf([rec(), rec({ id: "r2", name: "Beta", contactStatus: "NOT_CONTACTED", website: "https://beta.example.org" })], NOW);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
  });
});

// ---- per-NGO exports --------------------------------------------------------------------------------------------------
const HOST = "https://www.ashakiranfoundation.org";
const search: SearchLike = { isConfigured: true, async search(query) { return { query, provider: "mock", results: CLEAR_RESULTS, ok: true, errors: [] }; } };
const pages: Record<string, string> = {
  [canonicalUrl(`${HOST}/`)]: HOME_RICH, "/donate": DONATE_PAGE,
  "/about": "<html lang='en'><title>About</title><body><h1>About</h1></body></html>",
  "/contact": "<html lang='en'><title>Contact</title><body><h1>Contact</h1></body></html>",
};
const fetcher = {
  async get(url: string) {
    const body = pages[canonicalUrl(url)] ?? pages[new URL(url).pathname];
    return { requestedUrl: url, finalUrl: url, status: body ? ("OK" as const) : ("FAILED" as const), httpStatus: body ? 200 : 404, contentType: "text/html", body, headers: {}, redirects: [] as string[], error: body ? undefined : "HTTP 404", ms: 40 };
  },
  async robotsInfo() { return { found: false, sitemaps: [] as string[], blockedReason: undefined }; },
};
const APPROVED: PolicyConfig = {
  name: "Subsidised scope + maintenance", model: "SUBSIDIZED_MAINTENANCE", status: "APPROVED", isActive: true, approvedBy: "Founder", gstExtra: true,
  subsidizedServiceCodes: ["TP-02", "BR-17", "SEO-01"], maintenance: { mode: "BASELINE_TIER", tier: "SILVER" },
};

async function auditedView() {
  const store = new MemoryResearchStore();
  const catalogue = referenceCatalogue();
  const deps: PipelineDeps = { store, search, fetcher, catalogue, ai: null, now: () => new Date("2026-10-21T08:00:00Z") };
  const job = await store.createJob({ queryName: "Asha Kiran Foundation", queryLocation: "Hyderabad" });
  const done = await runPipeline(job.id, deps);
  const view = (await store.getNgoView(done.ngoId as string))!;
  const pricing = (policy: PolicyConfig | null) => buildPricingSection({ policy, recommendations: [], catalogue });
  return { store, view, pricing };
}

describe("per-NGO exports", () => {
  it("NGO-facing report never leaks scores, internal economics or reviewer notes — even with an approved policy", async () => {
    const { view, pricing } = await auditedView();
    for (const policy of [null, APPROVED]) {
      const doc = ngoFacingReport(view, pricing(policy), NOW);
      const text = JSON.stringify(doc);
      expect(text).not.toMatch(/opportunity score|prospect priority|digital readiness|internal/i);
      expect(text).not.toMatch(/\b\d{1,3} ?\/ ?100\b/);
      expect(text).toMatch(/Kreatif Atelier/);
      expect(text).not.toMatch(/Aurelius/);
    }
  });

  it("without an approved policy the NGO-facing pricing section quotes nothing", async () => {
    const { view, pricing } = await auditedView();
    const doc = ngoFacingReport(view, pricing(null), NOW);
    const p = doc.sections.find((s) => s.heading === "Pricing")!;
    expect(JSON.stringify(p)).not.toMatch(/₹|INR|\d{4,}/);
    expect(JSON.stringify(p)).toMatch(/confirmed the terms/i);
    const internal = internalReport(view, pricing(null), NOW);
    expect(JSON.stringify(internal.sections.find((s) => s.heading === "Pricing"))).toMatch(/needs human approval/);
  });

  it("the internal report is clearly marked internal and carries the score breakdown", async () => {
    const { view, pricing } = await auditedView();
    const doc = internalReport(view, pricing(null), NOW);
    expect(doc.subtitle).toMatch(/INTERNAL/);
    expect(doc.sections.map((s) => s.heading)).toEqual(expect.arrayContaining(["Summary", "Readiness by area", "Recommended services"]));
  });

  it("findings a reviewer rejected or excluded never reach the NGO-facing document", async () => {
    const { store, view, pricing } = await auditedView();
    const gap = view.findings.find((f) => f.section === "GAP");
    expect(gap).toBeTruthy();
    await store.reviewFinding(gap!.id, { reviewStatus: "EXCLUDED", reviewNote: "not relevant to this NGO" }, "me");
    const updated = (await store.getNgoView(view.ngo.id))!;
    const doc = ngoFacingReport(updated, pricing(null), NOW);
    const text = JSON.stringify(doc);
    expect(text).not.toContain(gap!.observation);
    expect(text).not.toContain("not relevant to this NGO");
    // …but the internal report still lists it, marked as excluded
    expect(JSON.stringify(internalReport(updated, pricing(null), NOW))).toContain("excluded — not relevant to this NGO");
  });

  it("each point appears once in the NGO-facing report, even though the audit records some points twice", async () => {
    const { view, pricing } = await auditedView();
    const titles = view.findings.map((f) => f.title.toLowerCase());
    expect(new Set(titles).size).toBeLessThan(titles.length); // the audit really does restate some points
    const doc = ngoFacingReport(view, pricing(null), NOW);
    for (const s of doc.sections.filter((x) => ["What is working well", "Opportunities we noticed", "What we could not assess"].includes(x.heading))) {
      const heads = (s.bullets ?? []).map((b) => b.split(/\.|:/)[0].toLowerCase());
      expect(new Set(heads).size, s.heading).toBe(heads.length);
    }
  });

  it("a draft notice appears while anything is still unapproved", async () => {
    const { view, pricing } = await auditedView();
    const doc = ngoFacingReport(view, pricing(null), NOW);
    expect(doc.draftNotice).toMatch(/DRAFT/);
  });

  it("proposal export is blocked until a proposal draft exists, and blocked again if rejected", async () => {
    const { view, pricing } = await auditedView();
    expect(() => proposalDoc({ ...view, pitches: [] }, pricing(null), NOW)).toThrow(ExportBlocked);
    const pitch = view.pitches[0];
    const rejected = { ...view, pitches: [{ ...pitch, drafts: pitch.drafts.map((d) => (d.channel === "ONE_PAGE_PROPOSAL" ? { ...d, status: "REJECTED" as const } : d)) }] };
    expect(() => proposalDoc(rejected, pricing(null), NOW)).toThrow(/rejected/);
  });

  it("proposal is marked DRAFT until approved and is blocked if the text mentions internal information", async () => {
    const { view, pricing } = await auditedView();
    const pitch = view.pitches[0];
    const withBody = (status: "DRAFT" | "APPROVED", body?: string) => ({
      ...view, pitches: [{ ...pitch, drafts: pitch.drafts.map((d) => (d.channel === "ONE_PAGE_PROPOSAL" ? { ...d, status, editedBody: body ?? d.editedBody } : d)) }],
    });
    expect(proposalDoc(withBody("DRAFT"), pricing(null), NOW).draftNotice).toMatch(/DRAFT/);
    expect(proposalDoc(withBody("APPROVED"), pricing(null), NOW).draftNotice).toBeUndefined();
    expect(() => proposalDoc(withBody("APPROVED", "Our opportunity score for you is 82/100 and our margin is healthy."), pricing(null), NOW)).toThrow(ExportBlocked);
  });

  it("renders real PDFs for the internal and NGO-facing models", async () => {
    const { view, pricing } = await auditedView();
    for (const doc of [internalReport(view, pricing(APPROVED), NOW), ngoFacingReport(view, pricing(APPROVED), NOW)]) {
      const pdf = await modelToPdf(doc);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(2000);
    }
  });
});

describe("pricing policy lifecycle (memory store)", () => {
  const input = { name: "Test policy", model: "SUBSIDIZED_MAINTENANCE" as const, gstExtra: true, subsidizedServiceCodes: ["TP-02"], maintenance: { mode: "BASELINE_TIER" as const, tier: "SILVER" as const } };

  it("saves as a draft, needs a person to approve, and approval records who approved", async () => {
    const store = new MemoryResearchStore();
    const saved = await store.savePolicy(input, "me");
    expect(saved).toMatchObject({ status: "DRAFT", isActive: false, approvedBy: null });
    expect(await store.getActivePolicy()).toBeNull();
    const ok = await store.setPolicyState(saved.id as string, "APPROVE", "Founder");
    expect(ok).toMatchObject({ status: "APPROVED", isActive: true, approvedBy: "Founder" });
    expect((await store.getActivePolicy())?.name).toBe("Test policy");
  });

  it("editing an approved policy resets it to draft, so edited terms are never silently live", async () => {
    const store = new MemoryResearchStore();
    const saved = await store.savePolicy(input, "me");
    await store.setPolicyState(saved.id as string, "APPROVE", "Founder");
    const edited = await store.savePolicy({ ...input, id: saved.id, subsidizedServiceCodes: ["TP-02", "SEO-01"] }, "me");
    expect(edited).toMatchObject({ status: "DRAFT", isActive: false, approvedBy: null });
    expect(await store.getActivePolicy()).toBeNull();
  });

  it("approving a second policy deactivates the first; retiring removes the active policy", async () => {
    const store = new MemoryResearchStore();
    const a = await store.savePolicy(input, "me");
    const b = await store.savePolicy({ ...input, name: "Second" }, "me");
    await store.setPolicyState(a.id as string, "APPROVE", "Founder");
    await store.setPolicyState(b.id as string, "APPROVE", "Founder");
    expect((await store.listPolicies()).filter((p) => p.isActive).map((p) => p.name)).toEqual(["Second"]);
    await store.setPolicyState(b.id as string, "RETIRE", "Founder");
    expect(await store.getActivePolicy()).toBeNull();
  });

  it("an unapproved or inactive policy never produces prices", () => {
    const catalogue = referenceCatalogue();
    for (const policy of [{ ...APPROVED, status: "DRAFT" as const }, { ...APPROVED, isActive: false }, { ...APPROVED, approvedBy: null }]) {
      const s = buildPricingSection({ policy, recommendations: [], catalogue });
      expect(s.status).not.toBe("APPROVED");
      expect(s.monthlyMaintenance).toBeNull();
      expect(s.oneTime).toEqual([]);
    }
  });
});

describe("found-online quick links", () => {
  it("lists the website, pages that loaded (not 404s), social profiles and registry links — all clickable URLs", async () => {
    const { quickLinks } = await import("@/lib/ui/quick-links");
    const { view } = await auditedView();
    const q = quickLinks(view);
    expect(q.website?.url).toMatch(/ashakiranfoundation\.org/);
    expect(q.pages.map((p) => p.label)).toContain("Donate");
    for (const l of q.pages) {
      const ev = view.evidence.find((e) => e.url === l.url);
      expect(ev?.fetchStatus).toBe("OK");
    }
    expect(q.pages.some((p) => /volunteer/.test(p.url))).toBe(false); // the volunteer link returned 404 in the fixture
    expect(q.social.map((s) => s.label)).toEqual(expect.arrayContaining(["Instagram", "Facebook", "LinkedIn"]));
    expect(q.verify.length).toBeGreaterThan(0);
    for (const l of [q.website!, ...q.pages, ...q.social, ...q.other, ...q.verify]) expect(l.url).toMatch(/^https?:\/\//);
  });
});
