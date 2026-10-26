import { isContactStatus, isInterestStatus, NOTE_MAX, PRIORITIES, PROFILE_KEYS, type Priority, type ProfileKey, type DirectoryEntry, type NgoFilter, type NgoPatch } from "@/lib/crm/types";
import { tidyPlace } from "@/lib/geo/areas";
import { HttpError } from "./http";

const text = (v: unknown, max: number, label: string): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new HttpError(400, `${label} must be text.`);
  const t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (t.length > max) throw new HttpError(400, `${label} is too long (${max} characters maximum).`);
  return t || null;
};

/** One or more numbers as typed ("98xxxxxx01 / 99xxxxxx02", "040-2770 0927"). Stored verbatim; each number must have 5–15 digits. */
export function parsePhone(v: unknown): string | null {
  const t = text(v, 80, "Phone");
  if (t === null) return null;
  if (!/^[+\d][\d\s().\-/,;+]*$/.test(t)) throw new HttpError(400, "That phone number does not look valid.");
  const parts = t.split(/[/,;]/).map((x) => x.replace(/\D/g, "")).filter(Boolean);
  if (parts.length === 0 || parts.length > 4 || parts.some((d) => d.length < 5 || d.length > 15)) throw new HttpError(400, "That phone number does not look valid.");
  return t;
}

export function parseWebsite(v: unknown): string | null {
  const t = text(v, 300, "Website");
  if (t === null) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); } catch { throw new HttpError(400, "That website address is not valid."); }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw new HttpError(400, "That website address is not valid.");
  return `${u.protocol}//${u.hostname}${u.pathname === "/" ? "" : u.pathname}`;
}

function parseEmail(v: unknown): string | null {
  const t = text(v, 200, "Email");
  if (t === null) return null;
  const parts = t.split(/[\s,;/]+/).filter(Boolean);
  if (!parts.length || parts.length > 4 || !parts.every((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) throw new HttpError(400, "That email address is not valid.");
  return parts.map((x) => x.toLowerCase()).join(" / ");
}

function parseCoord(v: unknown, min: number, max: number, label: string): number | null {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, `${label} is not valid.`);
  return v;
}

const PROFILE_MAX: Record<ProfileKey, number> = {
  organisationType: 120, instagram: 200, contactPerson: 160, designation: 160, whatTheyDo: 600, beneficiaries: 300, currentProjects: 600,
  mainNeed: 600, canHelpWith: 600, potentialProject: 300, partnershipValue: 60, priority: 10, nextAction: 600,
};

function parseInstagram(v: unknown): string | null {
  const t = text(v, 200, "Instagram");
  if (t === null) return null;
  // accept a handle (@name / name) or a profile link; store a link or the handle as typed
  if (/^https?:\/\//i.test(t)) { try { const u = new URL(t); if (!/instagram\.com$/i.test(u.hostname.replace(/^www\./, ""))) throw new Error(); return t; } catch { throw new HttpError(400, "That does not look like an Instagram link."); } }
  if (!/^@?[A-Za-z0-9._]{1,40}$/.test(t)) throw new HttpError(400, "Enter an Instagram handle (like @name) or a link.");
  return t;
}

export function parsePatch(b: Record<string, unknown>): NgoPatch {
  const p: NgoPatch = {};
  for (const k of PROFILE_KEYS) {
    if (b[k] === undefined) continue;
    if (k === "instagram") { p.instagram = parseInstagram(b[k]); continue; }
    const v = text(b[k], PROFILE_MAX[k], k);
    if (k === "priority" && v !== null && !(PRIORITIES as readonly string[]).includes(v)) throw new HttpError(400, "Priority must be High, Medium or Low.");
    p[k] = v;
  }
  if (b.contactedAt !== undefined) {
    if (b.contactedAt !== null && (typeof b.contactedAt !== "string" || Number.isNaN(Date.parse(b.contactedAt)))) throw new HttpError(400, "Last-contacted date is not valid.");
    p.contactedAt = b.contactedAt as string | null;
  }
  if (b.contactStatus !== undefined) { if (!isContactStatus(b.contactStatus)) throw new HttpError(400, "Unknown contact status."); p.contactStatus = b.contactStatus; }
  if (b.interestStatus !== undefined) { if (!isInterestStatus(b.interestStatus)) throw new HttpError(400, "Unknown interest status."); p.interestStatus = b.interestStatus; }
  if (b.inCrm !== undefined) { if (typeof b.inCrm !== "boolean") throw new HttpError(400, "inCrm must be true or false."); p.inCrm = b.inCrm; }
  if (b.notes !== undefined) p.notes = text(b.notes, NOTE_MAX, "Notes");
  if (b.phone !== undefined) p.phone = parsePhone(b.phone);
  if (b.email !== undefined) p.email = parseEmail(b.email);
  if (b.website !== undefined) p.website = parseWebsite(b.website);
  if (b.cause !== undefined) p.cause = text(b.cause, 160, "Cause");
  if (b.area !== undefined) p.area = text(b.area, 80, "Area");
  if (b.address !== undefined) p.address = text(b.address, 300, "Address");
  if (b.latitude !== undefined) p.latitude = parseCoord(b.latitude, -90, 90, "Latitude");
  if (b.longitude !== undefined) p.longitude = parseCoord(b.longitude, -180, 180, "Longitude");
  if (b.meetingScheduled !== undefined) { if (typeof b.meetingScheduled !== "boolean") throw new HttpError(400, "Meeting scheduled must be yes or no."); p.meetingScheduled = b.meetingScheduled; }
  if (b.meetingAt !== undefined) {
    if (b.meetingAt !== null && (typeof b.meetingAt !== "string" || Number.isNaN(Date.parse(b.meetingAt)))) throw new HttpError(400, "Meeting time is not valid.");
    p.meetingAt = b.meetingAt as string | null;
  }
  if (b.followUpAt !== undefined) {
    if (b.followUpAt !== null && (typeof b.followUpAt !== "string" || Number.isNaN(Date.parse(b.followUpAt)))) throw new HttpError(400, "Follow-up date is not valid.");
    p.followUpAt = b.followUpAt as string | null;
  }
  return p;
}

export function parseEntry(b: Record<string, unknown>, source: DirectoryEntry["source"]): DirectoryEntry {
  const name = text(b.name, 200, "Name");
  if (!name || name.length < 2) throw new HttpError(400, "Enter the NGO's name.");
  const city = tidyPlace(text(b.city, 80, "City"));
  if (!city) throw new HttpError(400, "Choose or enter a city.");
  const lat = b.latitude === undefined || b.latitude === null ? null : parseCoord(b.latitude, -90, 90, "Latitude");
  const lng = b.longitude === undefined || b.longitude === null ? null : parseCoord(b.longitude, -180, 180, "Longitude");
  return {
    name, city, source,
    area: text(b.area, 80, "Area") ?? undefined,
    cause: text(b.cause, 160, "Cause") ?? undefined,
    address: text(b.address, 300, "Address") ?? undefined,
    website: parseWebsite(b.website) ?? undefined,
    phone: b.phone ? parsePhone(b.phone) ?? undefined : undefined,
    email: b.email ? parseEmail(b.email) ?? undefined : undefined,
    latitude: lat ?? undefined, longitude: lng ?? undefined,
    geoBasis: lat !== null && lng !== null ? "entered by team" : undefined,
  };
}

export function parseIds(b: Record<string, unknown>): string[] {
  const ids = b.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || !ids.every((i) => typeof i === "string" && i.length > 0 && i.length < 80)) throw new HttpError(400, "Select between 1 and 1000 NGOs.");
  return ids as string[];
}

export function parseFilter(sp: URLSearchParams): NgoFilter {
  const f: NgoFilter = {};
  const pick = (k: string) => { const v = sp.get(k)?.trim(); return v && v !== "all" ? v.slice(0, 120) : undefined; };
  f.city = pick("city"); f.area = pick("area"); f.cause = pick("cause"); f.search = pick("search");
  const status = pick("status"); if (status) { if (!isContactStatus(status)) throw new HttpError(400, "Unknown contact status."); f.status = status; }
  const interest = pick("interest"); if (interest) { if (!isInterestStatus(interest)) throw new HttpError(400, "Unknown interest status."); f.interest = interest; }
  const priority = pick("priority"); if (priority) { if (!(PRIORITIES as readonly string[]).includes(priority)) throw new HttpError(400, "Unknown priority."); f.priority = priority as Priority; }
  const meeting = pick("meeting"); if (meeting === "yes" || meeting === "no") f.meeting = meeting === "yes";
  const darpan = pick("darpan"); if (darpan === "verified" || darpan === "unverified") f.darpan = darpan;
  const crm = pick("inCrm"); if (crm === "true" || crm === "false") f.inCrm = crm === "true";
  const audited = pick("audited"); if (audited === "true" || audited === "false") f.audited = audited === "true";
  return f;
}
