import ExcelJS from "exceljs";
import type { ContactStatus, DirectoryEntry, InterestStatus, Priority, ProfileKey } from "@/lib/crm/types";
import { areaFromAddress, areaPoint, tidyPlace, withApproxGeo } from "@/lib/geo/areas";

/**
 * Reads an NGO list from a spreadsheet (.xlsx) or CSV text into directory entries.
 * Pure parsing: no network, no database. Headers are matched by name (case/punctuation-insensitive), so any sheet that
 * uses the familiar columns works, in any order, with unknown columns ignored. Nothing is invented: a blank cell stays blank.
 */

export const MAX_IMPORT_ROWS = 2000;

type Field =
  | "name" | "city" | "area" | "address" | "cause" | "website" | "phone" | "email" | "notes" | "contactStatus" | "interestStatus" | "lastContacted"
  | ProfileKey;

const SYNONYMS: Record<Field, string[]> = {
  name: ["ngo name", "name", "organisation", "organization", "organisation name", "organization name"],
  city: ["city", "town", "location"],
  area: ["area", "locality", "neighbourhood", "neighborhood"],
  address: ["address", "full address"],
  cause: ["category", "cause", "sector", "focus area", "primary cause"],
  website: ["website", "web site", "url", "site"],
  phone: ["phone", "phone number", "mobile", "mobile number", "contact number", "telephone", "phone whatsapp", "whatsapp"],
  email: ["email", "e mail", "email id", "contact email"],
  notes: ["notes", "source notes", "research notes"],
  contactStatus: ["contact status", "contacted", "status"],
  interestStatus: ["interest", "interest status", "interested"],
  lastContacted: ["last contacted", "last contact", "contacted on", "date contacted"],
  organisationType: ["organisation type", "organization type", "org type", "type"],
  instagram: ["instagram", "insta"],
  contactPerson: ["contact person", "contact name", "primary contact", "point of contact"],
  designation: ["designation", "role", "title", "position"],
  whatTheyDo: ["what they do", "about", "description", "mission"],
  beneficiaries: ["beneficiaries", "who they serve"],
  currentProjects: ["current projects", "projects"],
  mainNeed: ["main need", "key need", "needs"],
  canHelpWith: ["asraya can help with", "can help with", "how we can help", "how can we help", "kreatif can help with"],
  potentialProject: ["potential project", "project idea"],
  partnershipValue: ["partnership value"],
  priority: ["priority"],
  nextAction: ["next action", "next step"],
};

const MAX_LEN: Record<string, number> = {
  name: 200, area: 80, address: 300, cause: 160, notes: 1200, organisationType: 120, instagram: 200, contactPerson: 160, designation: 160, whatTheyDo: 600,
  beneficiaries: 300, currentProjects: 600, mainNeed: 600, canHelpWith: 600, potentialProject: 300, partnershipValue: 60, priority: 10, nextAction: 600,
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Turn any exceljs cell value into plain text (numbers, dates, hyperlinks, rich text, formula results). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return o.richText.map((r) => cellText((r as { text?: unknown }).text)).join("");
    if ("result" in o) return cellText(o.result);
    if ("text" in o) return cellText(o.text);
    if ("hyperlink" in o) return cellText(o.hyperlink);
  }
  return "";
}

const clean = (v: unknown, max: number) => cellText(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

export interface ImportOptions {
  /** Used when a row has no usable city. Rows with neither are skipped. */
  defaultCity?: string;
}
export interface ImportResult {
  entries: DirectoryEntry[];
  skipped: { row: number; name?: string; reason: string }[];
  warnings: string[];
  headerRow: number | null;
  columns: { header: string; field: Field }[];
  unusedHeaders: string[];
}

function mapContact(v: string): ContactStatus | null {
  const n = norm(v);
  if (!n) return null;
  if (/^not /.test(n) || n === "no" || n === "pending") return "NOT_CONTACTED";
  if (n.includes("follow")) return "FOLLOW_UP_SCHEDULED";
  if (n === "contacted" || n === "yes" || n === "done") return "CONTACTED";
  return null;
}
function mapInterest(v: string): InterestStatus | null {
  const n = norm(v);
  if (!n) return null;
  if (n.includes("not interested") || n.includes("uninterested")) return "UNINTERESTED";
  if (n.includes("contract") || n === "signed") return "CONTRACT_SIGNED";
  if (n.includes("interested")) return "INTERESTED";
  if (n === "pending" || n === "unknown") return "PENDING";
  return null;
}

function validWebsite(v: string): string | null {
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || /\s/.test(v)) return null;
    return `${u.protocol}//${u.hostname}${u.pathname === "/" ? "" : u.pathname}`;
  } catch { return null; }
}
function validPhone(v: string): string | null {
  if (!v) return null;
  if (!/^[+\d][\d\s().\-/,;+]*$/.test(v)) return null;
  const parts = v.split(/[/,;]/).map((x) => x.replace(/\D/g, "")).filter(Boolean);
  return parts.length && parts.length <= 4 && parts.every((d) => d.length >= 5 && d.length <= 15) && v.length <= 80 ? v : null;
}
/** One or more addresses ("a@x.org / b@y.org"). Returns them joined with " / ", or null if any entry is not an address. */
export function validEmails(v: string): string | null {
  const parts = v.split(/[\s,;/]+/).filter(Boolean);
  if (!parts.length || parts.length > 4 || !parts.every((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) return null;
  const out = parts.map((x) => x.toLowerCase()).join(" / ");
  return out.length <= 200 ? out : null;
}
function validInstagram(v: string): string | null {
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) { try { return /instagram\.com$/i.test(new URL(v).hostname.replace(/^www\./, "")) ? v : null; } catch { return null; } }
  return /^@?[A-Za-z0-9._]{1,40}$/.test(v) ? v : null;
}
function toIso(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  const t = cellText(v).trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Finds the header row (the first of the top 15 rows that has a name column and at least one other recognised column) and maps columns. */
export function findHeader(rows: unknown[][]): { index: number; columns: { col: number; header: string; field: Field }[] } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cols: { col: number; header: string; field: Field }[] = [];
    const used = new Set<Field>();
    (rows[i] ?? []).forEach((cell, col) => {
      const n = norm(cellText(cell));
      if (!n) return;
      const field = (Object.keys(SYNONYMS) as Field[]).find((f) => !used.has(f) && SYNONYMS[f].includes(n));
      if (field) { used.add(field); cols.push({ col, header: cellText(cell).trim(), field }); }
    });
    if (used.has("name") && cols.length >= 2) return { index: i, columns: cols };
  }
  return null;
}

export function parseNgoRows(rows: unknown[][], opts: ImportOptions = {}): ImportResult {
  const out: ImportResult = { entries: [], skipped: [], warnings: [], headerRow: null, columns: [], unusedHeaders: [] };
  const header = findHeader(rows);
  if (!header) {
    out.warnings.push("No header row found. The sheet needs a column called “NGO Name” (or “Name”) and at least one other recognised column, such as Phone, Website, Location or Category.");
    return out;
  }
  out.headerRow = header.index + 1;
  out.columns = header.columns.map((c) => ({ header: c.header, field: c.field }));
  const mapped = new Set(header.columns.map((c) => c.col));
  out.unusedHeaders = (rows[header.index] ?? []).map((c, i) => (mapped.has(i) ? "" : cellText(c).trim())).filter(Boolean);
  const col = Object.fromEntries(header.columns.map((c) => [c.field, c.col])) as Partial<Record<Field, number>>;
  const get = (r: unknown[], f: Field) => (col[f] === undefined ? undefined : r[col[f] as number]);
  const warned = new Set<string>();
  const warnOnce = (m: string) => { if (!warned.has(m)) { warned.add(m); out.warnings.push(m); } };
  const seen = new Set<string>();
  const body = rows.slice(header.index + 1);
  if (body.length > MAX_IMPORT_ROWS) out.warnings.push(`Only the first ${MAX_IMPORT_ROWS} rows were read (${body.length} found).`);

  body.slice(0, MAX_IMPORT_ROWS).forEach((r, i) => {
    const rowNo = header.index + 2 + i;
    const name = clean(get(r, "name"), MAX_LEN.name);
    if (!name) { if ((r ?? []).some((c) => cellText(c).trim())) out.skipped.push({ row: rowNo, reason: "No NGO name." }); return; }
    // A "Location" style column can hold a city ("Hyderabad") or a locality; a dedicated City column wins.
    const cityCell = clean(get(r, "city"), 80);
    let areaCell = clean(get(r, "area"), MAX_LEN.area);
    let city = tidyPlace(cityCell);
    const asArea = city ? areaPoint(city) : null; // the "Location" cell named a locality, e.g. "Banjara Hills"
    if (asArea) { areaCell = areaCell || asArea.name; city = asArea.city; }
    city = city ?? tidyPlace(opts.defaultCity ?? "");
    if (!city) { out.skipped.push({ row: rowNo, name, reason: "No city (add a City column or choose a default city)." }); return; }
    const key = `${name.toLowerCase().replace(/\s+/g, " ")}|${city.toLowerCase()}`;
    if (seen.has(key)) { out.skipped.push({ row: rowNo, name, reason: "Duplicate of an earlier row in this file." }); return; }
    seen.add(key);

    const e: DirectoryEntry = { name, city, source: "IMPORT" };
    const notes = clean(get(r, "notes"), MAX_LEN.notes);
    let address = clean(get(r, "address"), MAX_LEN.address);
    if (!address && notes) {
      const m = /address:\s*(.+?)(?:\.\s*(?:Source|Website|Named)\b|$)/i.exec(notes);
      if (m) address = m[1].trim().slice(0, MAX_LEN.address);
    }
    if (address) e.address = address;
    const area = areaCell || areaFromAddress(address) || "";
    if (area) e.area = area;
    const cause = clean(get(r, "cause"), MAX_LEN.cause); if (cause) e.cause = cause;
    if (notes) e.sourceNote = notes;

    const asListed: string[] = []; // values that were not usable as typed are kept in the source note, never dropped silently
    const website = clean(get(r, "website"), 300);
    if (website) { const w = validWebsite(website); if (w) e.website = w; else { asListed.push(`Website: ${website}`); warnOnce(`Some website cells were not valid web addresses and were kept in the notes instead (first: row ${rowNo}, “${website.slice(0, 40)}”).`); } }
    const phone = clean(get(r, "phone"), 80);
    if (phone) { const p = validPhone(phone); if (p) e.phone = p; else { asListed.push(`Phone: ${phone}`); warnOnce(`Some phone cells did not look like phone numbers and were kept in the notes instead (first: row ${rowNo}, “${phone.slice(0, 30)}”).`); } }
    const email = clean(get(r, "email"), 120);
    if (email) { const m = validEmails(email); if (m) e.email = m; else { asListed.push(`Email: ${email}`); warnOnce(`Some email cells were not valid addresses and were kept in the notes instead (first: row ${rowNo}, “${email.slice(0, 40)}”).`); } }
    const insta = clean(get(r, "instagram"), 200);
    if (insta) { const g = validInstagram(insta); if (g) e.instagram = g; else { asListed.push(`Instagram: ${insta}`); warnOnce(`Some Instagram cells were not handles or Instagram links and were kept in the notes instead (first: row ${rowNo}).`); } }
    if (asListed.length) e.sourceNote = `${e.sourceNote ? `${e.sourceNote} ` : ""}As listed in the spreadsheet but not usable as typed — ${asListed.join("; ")}.`.slice(0, MAX_LEN.notes + 300);

    for (const k of ["organisationType", "contactPerson", "designation", "whatTheyDo", "beneficiaries", "currentProjects", "mainNeed", "canHelpWith", "potentialProject", "partnershipValue", "nextAction"] as const) {
      const v = clean(get(r, k), MAX_LEN[k]); if (v) e[k] = v;
    }
    const pr = clean(get(r, "priority"), 20);
    if (pr) {
      const p = (["High", "Medium", "Low"] as Priority[]).find((x) => x.toLowerCase() === pr.toLowerCase());
      if (p) e.priority = p; else warnOnce(`Some Priority cells were not High, Medium or Low and were left blank (first: row ${rowNo}, “${pr}”).`);
    }
    const cs = clean(get(r, "contactStatus"), 40);
    if (cs) { const m = mapContact(cs); if (m) e.contactStatus = m; else warnOnce(`Some Contact Status cells were not recognised (first: row ${rowNo}, “${cs}”); those NGOs start as Not contacted.`); }
    const ins = clean(get(r, "interestStatus"), 40);
    if (ins) { const m = mapInterest(ins); if (m) e.interestStatus = m; else warnOnce(`Some Interest cells were not recognised (first: row ${rowNo}, “${ins}”); those NGOs start as Pending.`); }
    const lc = toIso(get(r, "lastContacted")); if (lc) e.contactedAt = lc;

    out.entries.push(withApproxGeo(e));
  });
  return out;
}

/** Minimal RFC-4180 CSV reader (quotes, escaped quotes, embedded newlines, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ""; let q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Reads every worksheet of an .xlsx and returns the rows of the one that holds the NGO list (best header match, then most rows). */
export async function readXlsxRows(data: ArrayBuffer | Buffer): Promise<{ sheet: string; rows: unknown[][] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  let best: { sheet: string; rows: unknown[][]; score: number } | null = null;
  for (const ws of wb.worksheets) {
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      if (n > MAX_IMPORT_ROWS + 20) return;
      const vals: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => { vals[c - 1] = cell.value; });
      rows[n - 1] = vals;
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    const h = findHeader(rows);
    const score = h ? h.columns.length * 10000 + rows.length : 0;
    if (score && (!best || score > best.score)) best = { sheet: ws.name, rows, score };
  }
  if (!best) return { sheet: wb.worksheets[0]?.name ?? "", rows: [] };
  return { sheet: best.sheet, rows: best.rows };
}
