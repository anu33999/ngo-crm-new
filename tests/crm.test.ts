import { describe, expect, it } from "vitest";
import { referenceCatalogue } from "@/lib/catalogue";
import { starterEntries } from "@/lib/crm/directory";
import {
  applyPatchLocal, changeLines, emptyProfile, phoneNeedsCheck, contactedAtFor, facetsOf, matchesFilter, telHref, whatsappHref,
  type DirectoryEntry, type NgoRecord,
} from "@/lib/crm/types";
import { applyMapFilter, isReached } from "@/lib/geo/filter";
import { AREAS, jitter, pointFor, tidyPlace, TWIN_CITIES_VIEW } from "@/lib/geo/areas";
import { MemoryResearchStore } from "@/lib/research/memory-store";
import type { PipelineDeps, SearchLike } from "@/lib/research/pipeline";
import { runPipeline } from "@/lib/research/pipeline";
import { startBatch, startResearch } from "@/lib/research/runner";
import { canonicalUrl } from "@/lib/search/normalize";
import { HttpError } from "@/lib/server/http";
import { parseEntry, parsePatch, parsePhone, parseWebsite } from "@/lib/server/ngo-input";
import { seedDirectory } from "@/lib/server/directory";
import { CLEAR_RESULTS } from "./fixtures/search-results";
import { DONATE_PAGE, HOME_RICH } from "./fixtures/html";

const NOW = "2026-10-21T08:00:00.000Z";

function entry(over: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return { name: "Test Seva Trust", city: "Hyderabad", area: "Banjara Hills", cause: "Education & Literacy; Health & Family Welfare", source: "STARTER", ...over };
}

async function seeded() {
  const store = new MemoryResearchStore();
  const { created } = await store.upsertEntries([
    entry({ name: "Alpha Trust", cause: "Education & Literacy" }),
    entry({ name: "Beta Society", city: "Secunderabad", area: "West Marredpally", cause: "Health & Family Welfare" }),
    entry({ name: "Gamma Foundation", area: undefined, cause: "Environment" }),
  ], "test");
  return { store, records: created };
}

describe("bundled directory", () => {
  const entries = starterEntries();
  const darpan = entries.filter((e) => e.source === "STARTER");
  const sheet = entries.filter((e) => e.source === "IMPORT");
  it("has the 28 Darpan starters and the 248 spreadsheet NGOs, all in Hyderabad or Secunderabad, each with approximate coordinates", () => {
    expect(darpan).toHaveLength(28);
    expect(sheet).toHaveLength(248);
    expect(sheet.filter((e) => e.city === "Hyderabad")).toHaveLength(211);
    expect(sheet.filter((e) => e.city === "Secunderabad")).toHaveLength(37);
    expect(sheet.filter((e) => e.priority === "High")).toHaveLength(215);
    expect(new Set(entries.map((e) => e.city))).toEqual(new Set(["Hyderabad", "Secunderabad"]));
    for (const e of entries) {
      expect(e.geoBasis).toMatch(/approximate/);
      expect(e.latitude as number).toBeGreaterThan(17.2); expect(e.latitude as number).toBeLessThan(17.6);
      expect(e.longitude as number).toBeGreaterThan(78.2); expect(e.longitude as number).toBeLessThan(78.7);
    }
  });
  it("Darpan starters never carry invented contact details", () => {
    for (const e of darpan) { expect(e.phone).toBeUndefined(); expect(e.website).toBeUndefined(); expect(e.email).toBeUndefined(); }
  });
  it("spreadsheet entries keep phone numbers exactly as listed", () => {
    expect(sheet.find((e) => e.name === "Bethel Gospel Church for Girls")?.phone).toBe("9394825455");
    expect(sheet.filter((e) => e.phone)).toHaveLength(247);
  });
  it("has unique names within a city and a source note on every entry", () => {
    const keys = entries.map((e) => `${e.city}|${e.name}`.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of entries) expect(e.sourceNote).toBeTruthy();
  });
  it("seeding is idempotent", async () => {
    const store = new MemoryResearchStore();
    const first = await seedDirectory(store, "test");
    const second = await seedDirectory(store, "test");
    expect(first.created).toBe(entries.length);
    expect(second.created).toBe(0);
    expect(second.existing).toBe(entries.length);
    expect(await store.listRecords({})).toHaveLength(entries.length);
  });
});

describe("CRM store (memory)", () => {
  it("dedupes by name + city regardless of case and spacing", async () => {
    const { store } = await seeded();
    const again = await store.upsertEntries([entry({ name: "  ALPHA   trust " })], "test");
    expect(again.created).toHaveLength(0);
    expect(again.existing).toHaveLength(1);
    expect(await store.listRecords({})).toHaveLength(3);
  });

  it("new records start Not Contacted / Pending and out of the CRM", async () => {
    const { records } = await seeded();
    for (const r of records) {
      expect(r.contactStatus).toBe("NOT_CONTACTED");
      expect(r.interestStatus).toBe("PENDING");
      expect(r.inCrm).toBe(false);
      expect(r.contactedAt).toBeNull();
      expect(r.audited).toBe(false);
    }
  });

  it("marking contacted sets contactedAt once; resetting clears it; activity is logged as notes", async () => {
    const { store, records } = await seeded();
    const id = records[0].id;
    const a = await store.updateRecord(id, { contactStatus: "CONTACTED" }, "me");
    expect(a.contactStatus).toBe("CONTACTED");
    expect(a.contactedAt).toBeTruthy();
    const b = await store.updateRecord(id, { contactStatus: "FOLLOW_UP_SCHEDULED" }, "me");
    expect(b.contactedAt).toBe(a.contactedAt); // not reset when moving between contacted states
    const c = await store.updateRecord(id, { contactStatus: "NOT_CONTACTED" }, "me");
    expect(c.contactedAt).toBeNull();
    const notes = await store.listCrmNotes(id);
    expect(notes.some((n) => /Not contacted → Contacted/.test(n.content))).toBe(true);
  });

  it("bulkUpdate changes only the listed records and returns them", async () => {
    const { store, records } = await seeded();
    const out = await store.bulkUpdate([records[0].id, records[1].id], { inCrm: true }, "me");
    expect(out.map((r) => r.id).sort()).toEqual([records[0].id, records[1].id].sort());
    expect(out.every((r) => r.inCrm)).toBe(true);
    expect((await store.getRecord(records[2].id))?.inCrm).toBe(false);
  });

  it("filters by city, cause, status and search on the server side", async () => {
    const { store, records } = await seeded();
    await store.updateRecord(records[1].id, { contactStatus: "CONTACTED", inCrm: true }, "me");
    expect((await store.listRecords({ city: "Secunderabad" })).map((r) => r.name)).toEqual(["Beta Society"]);
    expect((await store.listRecords({ cause: "Environment" })).map((r) => r.name)).toEqual(["Gamma Foundation"]);
    expect((await store.listRecords({ status: "CONTACTED" })).map((r) => r.name)).toEqual(["Beta Society"]);
    expect((await store.listRecords({ inCrm: true })).map((r) => r.name)).toEqual(["Beta Society"]);
    expect((await store.listRecords({ search: "alph" })).map((r) => r.name)).toEqual(["Alpha Trust"]);
  });

  it("stores a human note and counts it", async () => {
    const { store, records } = await seeded();
    const n = await store.addCrmNote(records[0].id, "Called the office; ask for Mr. Rao", "Kreatif Team");
    expect(n.content).toMatch(/Mr\. Rao/);
    expect((await store.getRecord(records[0].id))?.noteCount).toBeGreaterThanOrEqual(1);
  });

  it("deleting an NGO removes its record and notes", async () => {
    const { store, records } = await seeded();
    await store.addCrmNote(records[0].id, "x", "me");
    await store.deleteNgo(records[0].id, "me");
    expect(await store.getRecord(records[0].id)).toBeNull();
    expect(await store.listCrmNotes(records[0].id)).toEqual([]);
  });
});

describe("pure CRM helpers (shared by server and the optimistic client store)", () => {
  const base: NgoRecord = {
    ...emptyProfile(), meetingScheduled: false, meetingAt: null,
    id: "n1", name: "Alpha Trust", location: "Banjara Hills, Hyderabad", city: "Hyderabad", area: "Banjara Hills", address: null, latitude: null, longitude: null, geoBasis: null,
    cause: "Education & Literacy; Health & Family Welfare", website: null, phone: null, email: null, darpanId: null, darpanStatus: "UNKNOWN", sourceNote: null, source: "STARTER",
    contactStatus: "NOT_CONTACTED", interestStatus: "PENDING", inCrm: false, notes: "Met at the fair", followUpAt: null, contactedAt: null, pitchSummary: null, matchedServiceCodes: [],
    audited: false, websiteStatus: "NOT_AUDITED", identityStatus: "UNCONFIRMED", lastResearchedAt: null, readinessScore: null, opportunityScore: null, latestJobId: null, noteCount: 0, createdAt: NOW, updatedAt: NOW,
  };

  it("matchesFilter handles multi-sector causes, case, and searches name/cause/area/notes", () => {
    expect(matchesFilter(base, { cause: "Health & Family Welfare" })).toBe(true);
    expect(matchesFilter(base, { cause: "health & family welfare" })).toBe(true);
    expect(matchesFilter(base, { cause: "Environment" })).toBe(false);
    expect(matchesFilter(base, { city: "hyderabad" })).toBe(true);
    expect(matchesFilter(base, { city: "Secunderabad" })).toBe(false);
    expect(matchesFilter(base, { city: "all", cause: "all" })).toBe(true);
    expect(matchesFilter(base, { search: "banjara" })).toBe(true);
    expect(matchesFilter(base, { search: "the fair" })).toBe(true);
    expect(matchesFilter(base, { search: "zzz" })).toBe(false);
    expect(matchesFilter(base, { darpan: "verified" })).toBe(false);
    expect(matchesFilter({ ...base, darpanStatus: "VERIFIED" }, { darpan: "verified" })).toBe(true);
  });

  it("contactedAtFor sets once and clears on reset", () => {
    expect(contactedAtFor({ contactStatus: "NOT_CONTACTED", contactedAt: null }, "CONTACTED", NOW)).toBe(NOW);
    expect(contactedAtFor({ contactStatus: "CONTACTED", contactedAt: "2026-10-01T00:00:00Z" }, "FOLLOW_UP_SCHEDULED", NOW)).toBe("2026-10-01T00:00:00Z");
    expect(contactedAtFor({ contactStatus: "CONTACTED", contactedAt: "2026-10-01T00:00:00Z" }, "NOT_CONTACTED", NOW)).toBeNull();
    expect(contactedAtFor({ contactStatus: "CONTACTED", contactedAt: "x" }, undefined, NOW)).toBe("x");
  });

  it("applyPatchLocal mirrors the server: status, notes, area relabels location", () => {
    const n = applyPatchLocal(base, { contactStatus: "CONTACTED", interestStatus: "INTERESTED", inCrm: true, notes: "hi", area: "Madhapur" }, NOW);
    expect(n).toMatchObject({ contactStatus: "CONTACTED", interestStatus: "INTERESTED", inCrm: true, notes: "hi", contactedAt: NOW, location: "Madhapur, Hyderabad" });
    expect(base.contactStatus).toBe("NOT_CONTACTED"); // input not mutated
  });

  it("changeLines describes only real changes", () => {
    expect(changeLines(base, { contactStatus: "NOT_CONTACTED" })).toEqual([]);
    expect(changeLines(base, { contactStatus: "CONTACTED", inCrm: true })).toHaveLength(2);
  });

  it("facetsOf derives filters from data and splits multi-sector causes", () => {
    const f = facetsOf([base, { ...base, id: "n2", city: "Secunderabad", cause: "Environment" }]);
    expect(f.cities).toEqual(["Hyderabad", "Secunderabad"]);
    expect(f.causes).toEqual(["Education & Literacy", "Environment", "Health & Family Welfare"]);
  });

  it("telHref / whatsappHref only build links for usable numbers", () => {
    expect(telHref("+91 98765 43210")).toBe("tel:+919876543210");
    expect(telHref("9398444410 / 9100563300")).toBe("tel:+919398444410");
    expect(telHref("040-27700927")).toBe("tel:+914027700927");
    expect(telHref("94400504485")).toBeNull(); // 11 digits, not 0-prefixed: shown as listed, flagged, not dialled
    expect(phoneNeedsCheck("94400504485")).toBe(true);
    expect(phoneNeedsCheck("9398444410 / 9100563300")).toBe(false);
    expect(phoneNeedsCheck(null)).toBe(false);
    expect(whatsappHref("040-27700927")).toBeNull(); // landline
    expect(telHref("123")).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(whatsappHref("98765 43210")).toBe("https://wa.me/919876543210");
    expect(whatsappHref("98765 43210", "Hi & hello")).toContain("?text=Hi%20%26%20hello");
    expect(whatsappHref("12345")).toBeNull();
  });
});

describe("geo helpers", () => {
  it("pointFor prefers record coordinates, then area centroid, then city centre, else null", () => {
    expect(pointFor({ latitude: 17.5, longitude: 78.5, geoBasis: "entered by team", area: "Madhapur", city: "Hyderabad" })).toEqual({ lat: 17.5, lng: 78.5, basis: "entered by team" });
    expect(pointFor({ latitude: null, longitude: null, geoBasis: null, area: "madhapur", city: "Hyderabad" })).toMatchObject({ basis: "area centroid (approximate)" });
    expect(pointFor({ latitude: null, longitude: null, geoBasis: null, area: "Unknown", city: "Secunderabad" })).toMatchObject({ basis: "city centre (approximate)" });
    expect(pointFor({ latitude: null, longitude: null, geoBasis: null, area: null, city: "Mumbai" })).toBeNull();
    expect(pointFor({ latitude: Number.NaN, longitude: 78, geoBasis: null, area: null, city: "Hyderabad" })).toMatchObject({ basis: "city centre (approximate)" });
  });
  it("jitter is deterministic, small, and differs by id", () => {
    const p = { lat: 17.4, lng: 78.4 };
    const a = jitter("id-1", p); const a2 = jitter("id-1", p); const b = jitter("id-2", p);
    expect(a).toEqual(a2);
    expect(a).not.toEqual(b);
    for (const q of [a, b]) { expect(Math.abs(q.lat - p.lat)).toBeLessThanOrEqual(0.0022); expect(Math.abs(q.lng - p.lng)).toBeLessThanOrEqual(0.0022); }
  });
  it("default map view is the twin cities centre at zoom 11, and every named area is in range", () => {
    expect(TWIN_CITIES_VIEW).toEqual({ lat: 17.4065, lng: 78.4772, zoom: 11 });
    for (const a of AREAS) { expect(a.lat).toBeGreaterThan(17.25); expect(a.lat).toBeLessThan(17.55); expect(a.lng).toBeGreaterThan(78.3); expect(a.lng).toBeLessThan(78.6); }
  });
  it("tidyPlace normalises case-only variants", () => {
    expect(tidyPlace("  hyderabad ")).toBe("Hyderabad");
    expect(tidyPlace("SECUNDERABAD")).toBe("Secunderabad");
    expect(tidyPlace("   ")).toBeNull();
  });
});

describe("map filter and reached/not-reached state", () => {
  const rs = [
    { id: "a", contactStatus: "NOT_CONTACTED" as const },
    { id: "b", contactStatus: "CONTACTED" as const },
    { id: "c", contactStatus: "FOLLOW_UP_SCHEDULED" as const },
  ];
  it("Show All / Reached Only / Not Reached Only", () => {
    expect(applyMapFilter(rs, "all")).toHaveLength(3);
    expect(applyMapFilter(rs, "reached").map((r) => r.id)).toEqual(["b", "c"]);
    expect(applyMapFilter(rs, "not-reached").map((r) => r.id)).toEqual(["a"]);
    expect(isReached(rs[2])).toBe(true);
  });
  it("toggling contact status on the shared record moves the pin between filters (same patch the CRM, Map popup and Discovery all send)", () => {
    const rec = { ...rs[0] };
    const toggled = { ...rec, contactStatus: rec.contactStatus === "NOT_CONTACTED" ? ("CONTACTED" as const) : ("NOT_CONTACTED" as const) };
    expect(applyMapFilter([toggled], "reached")).toHaveLength(1);
    expect(applyMapFilter([toggled], "not-reached")).toHaveLength(0);
  });
});

describe("request parsing (untrusted input)", () => {
  it("accepts tidy phones and rejects junk", () => {
    expect(parsePhone("+91 98765 43210")).toBe("+91 98765 43210");
    expect(parsePhone("  ")).toBeNull();
    expect(() => parsePhone("call me")).toThrow(HttpError);
    expect(() => parsePhone("12")).toThrow(HttpError);
    expect(() => parsePhone("1".repeat(20))).toThrow(HttpError);
  });
  it("normalises websites and rejects non-http schemes", () => {
    expect(parseWebsite("example.org")).toBe("https://example.org");
    expect(parseWebsite("http://example.org/")).toBe("http://example.org");
    expect(() => parseWebsite("javascript:alert(1)")).toThrow(HttpError);
    expect(() => parseWebsite("nodots")).toThrow(HttpError);
  });
  it("parsePatch validates enums, booleans, coordinates and strips control characters", () => {
    expect(parsePatch({ contactStatus: "CONTACTED", interestStatus: "INTERESTED", inCrm: true })).toEqual({ contactStatus: "CONTACTED", interestStatus: "INTERESTED", inCrm: true });
    expect(() => parsePatch({ contactStatus: "DONE" })).toThrow(HttpError);
    expect(() => parsePatch({ interestStatus: "maybe" })).toThrow(HttpError);
    expect(() => parsePatch({ inCrm: "yes" })).toThrow(HttpError);
    expect(() => parsePatch({ latitude: 200 })).toThrow(HttpError);
    expect(() => parsePatch({ notes: "x".repeat(5000) })).toThrow(HttpError);
    expect(parsePatch({ notes: "a\u0000b\u0007c" }).notes).toBe("abc");
    expect(() => parsePatch({ followUpAt: "not a date" })).toThrow(HttpError);
  });
  it("parseEntry requires a name and city and never fabricates other fields", () => {
    expect(() => parseEntry({ name: "A", city: "Hyderabad" }, "MANUAL")).toThrow(HttpError);
    expect(() => parseEntry({ name: "Valid Name" }, "MANUAL")).toThrow(HttpError);
    const e = parseEntry({ name: "Valid Name", city: "hyderabad" }, "MANUAL");
    expect(e).toMatchObject({ name: "Valid Name", city: "Hyderabad", source: "MANUAL" });
    expect(e.phone).toBeUndefined(); expect(e.website).toBeUndefined(); expect(e.latitude).toBeUndefined();
  });
});

// ---- audit write-back + batch runs ----
const HOST = "https://www.ashakiranfoundation.org";
const search: SearchLike = {
  isConfigured: true,
  async search(query) { return { query, provider: "mock", results: CLEAR_RESULTS, ok: true, errors: [] }; },
};
const pages: Record<string, string> = {
  [canonicalUrl(`${HOST}/`)]: HOME_RICH,
  "/donate": DONATE_PAGE,
  "/about": "<html lang='en'><title>About</title><body><h1>About</h1></body></html>",
  "/contact": "<html lang='en'><title>Contact</title><body><h1>Contact</h1></body></html>",
};
const fetcher = {
  async get(url: string) {
    const body = pages[canonicalUrl(url)] ?? pages[new URL(url).pathname];
    return { requestedUrl: url, finalUrl: url, status: body ? ("OK" as const) : ("FAILED" as const), httpStatus: body ? 200 : 404, contentType: "text/html", body, headers: {}, redirects: [] as string[], error: body ? undefined : "HTTP 404", ms: 50 };
  },
  async robotsInfo() { return { found: false, sitemaps: [] as string[], blockedReason: undefined }; },
};
const mkDeps = (store: MemoryResearchStore): PipelineDeps => ({ store, search, fetcher, catalogue: referenceCatalogue(), ai: null, now: () => new Date("2026-10-21T08:00:00Z") });

async function until<T>(f: () => Promise<T | null | false>, ms = 10000): Promise<T> {
  const t0 = Date.now();
  for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 25)); }
}

describe("audit results flow back into the CRM record", () => {
  it("fills blank phone/website/summary/scores, marks audited, and keeps human-entered values", async () => {
    const store = new MemoryResearchStore();
    const { created } = await store.upsertEntries([entry({ name: "Asha Kiran Foundation", area: "Banjara Hills" })], "test");
    const rec = created[0];
    await store.updateRecord(rec.id, { phone: "+91 90000 11111", notes: "Warm lead" }, "me");
    const job = await store.createJob({ queryName: rec.name, queryLocation: rec.city ?? undefined, ngoId: rec.id });
    const done = await runPipeline(job.id, mkDeps(store));
    expect(["COMPLETED", "PARTIAL"]).toContain(done.status);
    expect(done.ngoId).toBe(rec.id); // audit attaches to the directory record rather than creating a duplicate
    const after = (await store.getRecord(rec.id)) as NgoRecord;
    expect(after.audited).toBe(true);
    expect(after.website).toMatch(/ashakiranfoundation/);
    expect(after.websiteStatus).not.toBe("NOT_AUDITED");
    expect(after.phone).toBe("+91 90000 11111"); // never overwritten by scraped data
    expect(after.notes).toBe("Warm lead");
    expect(after.pitchSummary).toBeTruthy();
    expect(after.readinessScore).not.toBeUndefined();
    expect(after.latestJobId).toBe(done.id);
    expect((await store.listRecords({})).length).toBe(1);
  });

  it("startResearch for an audited record returns the saved audit without re-running; refresh creates a new job", async () => {
    const store = new MemoryResearchStore();
    const d = mkDeps(store);
    const { created } = await store.upsertEntries([entry({ name: "Asha Kiran Foundation" })], "test");
    const first = await startResearch(d, { ngoId: created[0].id });
    expect(first.cached).toBe(false);
    await until(async () => { const j = await store.getJob(first.jobId); return j && ["COMPLETED", "PARTIAL", "FAILED"].includes(j.status) ? j : false; });
    const again = await startResearch(d, { ngoId: created[0].id });
    expect(again).toMatchObject({ cached: true, jobId: first.jobId });
    const refreshed = await startResearch(d, { ngoId: created[0].id, refresh: true });
    expect(refreshed.cached).toBe(false);
    expect(refreshed.jobId).not.toBe(first.jobId);
    await until(async () => { const j = await store.getJob(refreshed.jobId); return j && ["COMPLETED", "PARTIAL", "FAILED"].includes(j.status) ? j : false; });
  });

  it("startBatch audits several records, skips already-audited ones and unknown ids, and caps concurrency input", async () => {
    const store = new MemoryResearchStore();
    const d = mkDeps(store);
    const { created } = await store.upsertEntries([entry({ name: "Asha Kiran Foundation" }), entry({ name: "Asha Kiran Foundation Annex", city: "Secunderabad", area: undefined })], "test");
    const out = await startBatch(d, [created[0].id, created[1].id, "missing-id", created[0].id], { concurrency: 99 });
    expect(out.started.map((s) => s.ngoId).sort()).toEqual([created[0].id, created[1].id].sort());
    expect(out.skipped).toEqual([expect.objectContaining({ ngoId: "missing-id" })]);
    for (const s of out.started) await until(async () => { const j = await store.getJob(s.jobId); return j && ["COMPLETED", "PARTIAL", "FAILED", "AWAITING_DISAMBIGUATION"].includes(j.status) ? j : false; });
    const second = await startBatch(d, [created[0].id]);
    const rec = (await store.getRecord(created[0].id)) as NgoRecord;
    if (rec.audited) expect(second.skipped[0]?.reason).toMatch(/Already audited/);
  });
});

describe("categories", () => {
  it("maps causes and strong name signals to one clear set, and filters by it", async () => {
    const { categoriesOf } = await import("@/lib/crm/types");
    expect(categoriesOf({ cause: "Children / education" })).toEqual(["Children", "Education"]);
    expect(categoriesOf({ cause: "Animal welfare / environment", name: "Blue Cross of Hyderabad" })).toEqual(["Animals", "Environment"]);
    expect(categoriesOf({ cause: "Social development", name: "Fatima Old Age Home" })).toEqual(["Elderly", "Social development"]);
    expect(categoriesOf({ cause: "Social development", name: "X", whatTheyDo: "for disadvantaged families" })).toEqual(["Social development"]);
    expect(categoriesOf({ cause: null, name: "Stray Dogs Rescue Trust" })).toEqual(["Animals"]);
    const sheet = starterEntries().filter((e) => e.source === "IMPORT").map((e) => ({ ...e, cause: e.cause ?? null, whatTheyDo: e.whatTheyDo ?? null, beneficiaries: e.beneficiaries ?? null }));
    expect(sheet.filter((e) => categoriesOf(e).includes("Animals")).length).toBeGreaterThanOrEqual(4);
    expect(sheet.filter((e) => categoriesOf(e).includes("Elderly")).length).toBeGreaterThanOrEqual(2);
    expect(sheet.every((e) => categoriesOf(e).length > 0)).toBe(true);
  });
});

describe("meetings", () => {
  it("meeting time sets Yes; No clears the time; both are logged and filterable", async () => {
    const store = new MemoryResearchStore();
    const { created } = await store.upsertEntries([{ name: "M Trust", city: "Hyderabad", source: "MANUAL" }], "me");
    const id = created[0].id;
    expect(created[0]).toMatchObject({ meetingScheduled: false, meetingAt: null });
    let r = await store.updateRecord(id, parsePatch({ meetingAt: "2026-10-24T10:00:00.000Z" }), "me");
    expect(r).toMatchObject({ meetingScheduled: true, meetingAt: "2026-10-24T10:00:00.000Z" });
    expect((await store.listRecords({ meeting: true })).map((x) => x.id)).toEqual([id]);
    r = await store.updateRecord(id, parsePatch({ meetingScheduled: false }), "me");
    expect(r).toMatchObject({ meetingScheduled: false, meetingAt: null });
    expect((await store.listCrmNotes(id)).some((n) => /Meeting scheduled/.test(n.content))).toBe(true);
    expect(() => parsePatch({ meetingScheduled: "yes" })).toThrow(HttpError);
    expect(() => parsePatch({ meetingAt: "soon" })).toThrow(HttpError);
    const local = applyPatchLocal({ ...(await store.getRecord(id))! }, { meetingAt: "2026-11-01T05:30:00.000Z" }, NOW);
    expect(local.meetingScheduled).toBe(true);
  });
});
