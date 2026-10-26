import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryResearchStore } from "@/lib/research/memory-store";
import { cellText, findHeader, parseCsv, parseNgoRows, readXlsxRows, validEmails } from "@/lib/import/ngo-sheet";
import { areaFromAddress } from "@/lib/geo/areas";
import { parsePatch, parsePhone } from "@/lib/server/ngo-input";
import { HttpError } from "@/lib/server/http";

const WORKBOOK = path.join(__dirname, "..", "reference", "Asraya_HYD_NGO_list.xlsx");

describe("spreadsheet import — the team's Asraya workbook", () => {
  it("finds the NGO Database sheet and its header row under the title rows, and maps every filled column", async () => {
    const { sheet, rows } = await readXlsxRows(fs.readFileSync(WORKBOOK));
    expect(sheet).toBe("NGO Database");
    const out = parseNgoRows(rows);
    expect(out.headerRow).toBe(5);
    expect(out.entries).toHaveLength(248);
    expect(out.skipped).toEqual([]);
    expect(out.unusedHeaders).toEqual([]);
    const fields = out.columns.map((c) => c.field);
    for (const f of ["name", "city", "cause", "website", "phone", "email", "contactPerson", "priority", "contactStatus", "nextAction", "notes"]) expect(fields).toContain(f);
  });

  it("matches the workbook's own dashboard counts", async () => {
    const { rows } = await readXlsxRows(fs.readFileSync(WORKBOOK));
    const e = parseNgoRows(rows).entries;
    expect(e.filter((x) => x.city === "Hyderabad")).toHaveLength(211);
    expect(e.filter((x) => x.city === "Secunderabad")).toHaveLength(37);
    expect(e.filter((x) => x.priority === "High")).toHaveLength(215);
    expect(e.filter((x) => x.contactStatus === "CONTACTED")).toHaveLength(1);
  });

  it("keeps two-number phones and two-address emails, and preserves an unusable email in the source note rather than dropping it", async () => {
    const { rows } = await readXlsxRows(fs.readFileSync(WORKBOOK));
    const out = parseNgoRows(rows);
    expect(out.entries.some((x) => x.phone?.includes(" / "))).toBe(true);
    expect(out.entries.filter((x) => x.email?.includes(" / ")).length).toBeGreaterThanOrEqual(7);
    const bad = out.entries.find((x) => x.sourceNote?.includes("dpkbabu2ashrayakruti.in"));
    expect(bad?.email).toBeUndefined();
    expect(bad?.sourceNote).toMatch(/not usable as typed — Email: dpkbabu2ashrayakruti\.in/);
  });

  it("pulls the address out of the notes and places known localities, leaving the rest at city level", async () => {
    const { rows } = await readXlsxRows(fs.readFileSync(WORKBOOK));
    const bethel = parseNgoRows(rows).entries.find((x) => x.name === "Bethel Gospel Church for Girls")!;
    expect(bethel.address).toBe("H.No:2-3-691/B/3, Annapurna Nagar, Amberpet");
    expect(bethel.area).toBe("Amberpet");
    expect(bethel.geoBasis).toBe("area centroid (approximate)");
    expect(areaFromAddress("ARUN URH, Vijaya Nagar Colony")).toBe("Vijaya Nagar Colony");
    expect(areaFromAddress("12, West Maredpally, 500026")).toBe("West Marredpally");
    expect(areaFromAddress("Somewhere unknown")).toBeNull();
  });
});

describe("spreadsheet import — any sheet", () => {
  it("matches headers in any order and case, ignores unknown columns, and never invents values", () => {
    const rows = [
      ["My NGO list"],
      [],
      ["website", "PHONE NUMBER", "Name", "City", "Favourite colour", "Priority", "Contacted"],
      ["helpinghand.org", "98480 12345", "Helping Hand", "hyderabad", "blue", "high", "yes"],
      ["", "", "Quiet Trust", "Secunderabad", "", "", ""],
    ];
    const out = parseNgoRows(rows);
    expect(out.headerRow).toBe(3);
    expect(out.unusedHeaders).toEqual(["Favourite colour"]);
    expect(out.entries[0]).toMatchObject({ name: "Helping Hand", city: "Hyderabad", website: "https://helpinghand.org", phone: "98480 12345", priority: "High", contactStatus: "CONTACTED", source: "IMPORT" });
    expect(out.entries[1]).toMatchObject({ name: "Quiet Trust", city: "Secunderabad" });
    for (const k of ["website", "phone", "email", "priority", "contactStatus"] as const) expect(out.entries[1][k]).toBeUndefined();
  });

  it("treats a locality in the Location column as the area, and uses the default city only when a row has none", () => {
    const rows = [["NGO Name", "Location", "Category"], ["A Trust", "Banjara Hills", "Health"], ["B Trust", "", "Health"]];
    expect(parseNgoRows(rows).skipped).toEqual([expect.objectContaining({ name: "B Trust", reason: expect.stringMatching(/No city/) })]);
    const out = parseNgoRows(rows, { defaultCity: "Secunderabad" });
    expect(out.entries[0]).toMatchObject({ city: "Hyderabad", area: "Banjara Hills" });
    expect(out.entries[1]).toMatchObject({ city: "Secunderabad" });
  });

  it("skips duplicates within a file and rows without a name, and reports why", () => {
    const rows = [["Name", "City"], ["A", "Hyderabad"], ["a ", "hyderabad"], ["", "Hyderabad"], ["B", "Hyderabad"]];
    const out = parseNgoRows(rows);
    expect(out.entries.map((e) => e.name)).toEqual(["A", "B"]);
    expect(out.skipped.map((s) => s.reason)).toEqual(["Duplicate of an earlier row in this file.", "No NGO name."]);
  });

  it("rejects sheets without a recognisable header", () => {
    const out = parseNgoRows([["foo", "bar"], ["1", "2"]]);
    expect(out.headerRow).toBeNull();
    expect(out.warnings[0]).toMatch(/NGO Name/);
  });

  it("strips control characters and keeps formula-looking text as plain text (exports guard it later)", () => {
    const out = parseNgoRows([["Name", "City", "Next action"], ["X\u0007 Trust", "Hyderabad", "=HYPERLINK(\"http://evil\")"]]);
    expect(out.entries[0].name).toBe("X Trust");
    expect(out.entries[0].nextAction).toBe("=HYPERLINK(\"http://evil\")");
  });

  it("reads hyperlink, rich-text and formula cells as text", () => {
    expect(cellText({ text: "Site", hyperlink: "https://a.org" })).toBe("Site");
    expect(cellText({ richText: [{ text: "Ab" }, { text: "c" }] })).toBe("Abc");
    expect(cellText({ formula: "A1", result: 42 })).toBe("42");
    expect(cellText(9394825455)).toBe("9394825455");
  });

  it("parses CSV with quotes, commas, newlines and a BOM", () => {
    const rows = parseCsv('﻿Name,City,Notes\r\n"A, Trust",Hyderabad,"line1\nline2 ""q"""\r\nB,Secunderabad,');
    expect(rows).toEqual([["Name", "City", "Notes"], ["A, Trust", "Hyderabad", 'line1\nline2 "q"'], ["B", "Secunderabad", ""]]);
    expect(findHeader(rows)?.index).toBe(0);
  });

  it("validEmails accepts several addresses and rejects any malformed one", () => {
    expect(validEmails("A@x.org / b@y.in")).toBe("a@x.org / b@y.in");
    expect(validEmails("a@x.org, nope")).toBeNull();
  });
});

describe("importing into the store", () => {
  it("adds new NGOs; a re-import only fills empty fields and never overwrites what a person typed or their contact status", async () => {
    const store = new MemoryResearchStore();
    const first = parseNgoRows([["Name", "City", "Phone"], ["Asha Trust", "Hyderabad", ""]]).entries;
    const { created } = await store.upsertEntries(first, "me", { fillBlanks: true });
    const id = created[0].id;
    await store.updateRecord(id, { notes: "Spoke to Ravi", contactStatus: "CONTACTED", website: "https://mine.org" }, "me");
    const again = parseNgoRows([["Name", "City", "Phone", "Website", "Contact Status", "Contact person"], ["asha trust", "Hyderabad", "9876543210", "https://theirs.org", "Not contacted", "Ravi"]]).entries;
    const out = await store.upsertEntries(again, "me", { fillBlanks: true });
    expect(out.created).toHaveLength(0);
    expect(out.updated).toHaveLength(1);
    const r = (await store.getRecord(id))!;
    expect(r).toMatchObject({ phone: "9876543210", contactPerson: "Ravi", website: "https://mine.org", contactStatus: "CONTACTED", notes: "Spoke to Ravi" });
  });

  it("without fillBlanks an existing record is left untouched", async () => {
    const store = new MemoryResearchStore();
    await store.upsertEntries([{ name: "Z", city: "Hyderabad", source: "MANUAL" }], "me");
    const out = await store.upsertEntries([{ name: "Z", city: "Hyderabad", source: "IMPORT", phone: "9876543210" }], "me");
    expect(out.updated).toHaveLength(0);
    expect((await store.listRecords({}))[0].phone).toBeNull();
  });

  it("all profile fields are editable through the same validated patch", async () => {
    const p = parsePatch({ contactPerson: "Ravi", priority: "High", nextAction: "Call Monday", instagram: "@asha.trust", email: "a@x.org / b@y.org", contactedAt: "2026-10-20T09:00:00.000Z", phone: "9398444410 / 9100563300" });
    expect(p).toMatchObject({ contactPerson: "Ravi", priority: "High", email: "a@x.org / b@y.org", phone: "9398444410 / 9100563300" });
    expect(() => parsePatch({ priority: "Urgent" })).toThrow(HttpError);
    expect(() => parsePatch({ instagram: "https://evil.example.com/x" })).toThrow(HttpError);
    expect(() => parsePatch({ contactedAt: "yesterday-ish" })).toThrow(HttpError);
    expect(() => parsePhone("98765 / 12")).toThrow(HttpError);
    const store = new MemoryResearchStore();
    const { created } = await store.upsertEntries([{ name: "Q", city: "Hyderabad", source: "MANUAL" }], "me");
    const r = await store.updateRecord(created[0].id, p, "me");
    expect(r).toMatchObject({ contactPerson: "Ravi", priority: "High", nextAction: "Call Monday", instagram: "@asha.trust", contactedAt: "2026-10-20T09:00:00.000Z" });
    expect((await store.listRecords({ priority: "High" })).map((x) => x.name)).toEqual(["Q"]);
    expect((await store.listRecords({ search: "ravi" })).map((x) => x.name)).toEqual(["Q"]);
  });
});

describe("setup error hints", () => {
  it("turns common Prisma setup errors into a one-line fix", async () => {
    const { fixHint } = await import("@/lib/server/http");
    expect(fixHint(new Error("@prisma/client did not initialize yet. Please run \"prisma generate\""))).toMatch(/npx prisma generate/);
    expect(fixHint(new Error("The column `main.Ngo.priority` does not exist in the current database."))).toMatch(/npx prisma migrate dev/);
    expect(fixHint(new Error("something else"))).toBeNull();
  });
});
