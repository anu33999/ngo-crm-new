/**
 * CRM + directory types shared by server, stores and client components.
 * Pure data and pure functions only — nothing here may import server code.
 */

export const CONTACT_STATUSES = ["NOT_CONTACTED", "CONTACTED", "FOLLOW_UP_SCHEDULED"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const INTEREST_STATUSES = ["PENDING", "INTERESTED", "UNINTERESTED", "CONTRACT_SIGNED"] as const;
export type InterestStatus = (typeof INTEREST_STATUSES)[number];

export type NgoSource = "STARTER" | "DISCOVERED" | "MANUAL" | "SEARCH" | "IMPORT";
export type DarpanStatus = "VERIFIED" | "UNVERIFIED" | "NOT_FOUND" | "UNKNOWN";
export type WebsiteStatus = "REACHABLE" | "NOT_FOUND_PUBLICLY" | "UNABLE_TO_ASSESS" | "NOT_AUDITED";

export const CONTACT_LABEL: Record<ContactStatus, string> = { NOT_CONTACTED: "Not contacted", CONTACTED: "Contacted", FOLLOW_UP_SCHEDULED: "Follow-up scheduled" };
export const INTEREST_LABEL: Record<InterestStatus, string> = { PENDING: "Pending", INTERESTED: "Interested", UNINTERESTED: "Uninterested", CONTRACT_SIGNED: "Contract signed" };
export const WEBSITE_LABEL: Record<WebsiteStatus, string> = {
  REACHABLE: "Website reachable", NOT_FOUND_PUBLICLY: "Website not found publicly", UNABLE_TO_ASSESS: "Website could not be assessed", NOT_AUDITED: "Not audited yet",
};
export const DARPAN_LABEL: Record<DarpanStatus, string> = {
  VERIFIED: "Darpan: named in registry page", UNVERIFIED: "Darpan: claimed, not verified", NOT_FOUND: "Darpan: not found in sources checked", UNKNOWN: "Darpan: not checked",
};
export const SOURCE_NOTE: Record<NgoSource, string> = {
  STARTER: "Starter list entry — unverified",
  DISCOVERED: "Found by search and confirmed by a person",
  MANUAL: "Added by hand",
  SEARCH: "Researched by name",
  IMPORT: "Imported from a spreadsheet",
};

/** Free-text profile fields that come from a spreadsheet import or are typed by the team. All nullable, all editable. */
export const PROFILE_KEYS = [
  "organisationType", "instagram", "contactPerson", "designation", "whatTheyDo", "beneficiaries", "currentProjects",
  "mainNeed", "canHelpWith", "potentialProject", "partnershipValue", "priority", "nextAction",
] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];
export type Profile = Record<ProfileKey, string | null>;
export const PRIORITIES = ["High", "Medium", "Low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const emptyProfile = (): Profile => Object.fromEntries(PROFILE_KEYS.map((k) => [k, null])) as Profile;

// ── Categories ────────────────────────────────────────────────────────────────
/** One clear set of categories derived from the free-text cause (and strong signals in the name / description). */
export const CATEGORIES = [
  "Animals", "Elderly", "Children", "Education", "Shelter & homes", "Women", "Health", "Disability", "Environment",
  "Livelihoods & skills", "Arts & culture", "Social development",
] as const;
export type Category = (typeof CATEGORIES)[number];

const CAUSE_RULES: [Category, RegExp][] = [
  ["Animals", /\banimal|\bdogs?\b|\bcats?\b|\bcows?\b|\bgau\b|wildlife|\bpets?\b|veterin|blue cross|\bstray|husbandry/i],
  ["Elderly", /\bold[- ]age\b|\belder(ly)?\b|senior citizens?|\bvridh|\bageing\b|\baged (people|persons)|alzheimer|dementia/i],
  ["Children", /\bchild|\borphan|\bkids?\b|\bbal(a|ika)?\b|\b(for|home for) (boys|girls)\b/i],
  ["Education", /educat|literacy|\bschool|learning|scholarship/i],
  ["Shelter & homes", /shelter|\bhomes?\b|orphanage|residential care|child care/i],
  ["Women", /\bwomen|\bwomen's|gender|\bmahila|\bgirls?\b/i],
  ["Health", /health|medical|hospital|cancer|\bhiv\b|\bblood\b|disease|nutrition|family welfare|mental/i],
  ["Disability", /disab|differently abled|\bpwds?\b|\bblind|\bdeaf|special needs|autism/i],
  ["Environment", /environment|climate|forest|\bwater\b|\btrees?\b|\bgreen\b|sanitation|\bwaste\b/i],
  ["Livelihoods & skills", /livelihood|\bskill|employ|vocational|small & medium|enterprise|agricultur/i],
  ["Arts & culture", /\barts?\b|culture|heritage/i],
  ["Social development", /social development|human rights|rural|poverty|community|youth affairs|science|technology/i],
];
/** Categories that are clear enough to pick up from the name or description even when the cause says something broader. */
const STRONG: Category[] = ["Animals", "Elderly", "Disability"];

export function categoriesOf(r: { cause: string | null; name?: string; whatTheyDo?: string | null; beneficiaries?: string | null }): Category[] {
  const cause = r.cause ?? "";
  const out = new Set<Category>(CAUSE_RULES.filter(([, re]) => re.test(cause)).map(([c]) => c));
  const extra = [r.name, r.whatTheyDo, r.beneficiaries].filter(Boolean).join(" ");
  for (const [c, re] of CAUSE_RULES) if (STRONG.includes(c) && re.test(extra)) out.add(c);
  if (!out.size && extra) for (const [c, re] of CAUSE_RULES) if (re.test(extra)) out.add(c);
  return CATEGORIES.filter((c) => out.has(c));
}

export interface NgoRecord extends Profile {
  id: string;
  name: string;
  /** Display label, e.g. "Banjara Hills, Hyderabad". */
  location: string | null;
  city: string | null;
  area: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  /** How the coordinates were obtained (e.g. "area centroid (approximate)"). Pins are never presented as exact. */
  geoBasis: string | null;
  cause: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  darpanId: string | null;
  darpanStatus: DarpanStatus;
  sourceNote: string | null;
  source: NgoSource;
  contactStatus: ContactStatus;
  interestStatus: InterestStatus;
  inCrm: boolean;
  notes: string | null;
  followUpAt: string | null;
  /** Yes/No: is a meeting booked with this NGO? */
  meetingScheduled: boolean;
  /** When the meeting is (ISO date-time), if known. */
  meetingAt: string | null;
  contactedAt: string | null;
  pitchSummary: string | null;
  matchedServiceCodes: string[];
  audited: boolean;
  websiteStatus: WebsiteStatus;
  identityStatus: string;
  lastResearchedAt: string | null;
  readinessScore: number | null;
  opportunityScore: number | null;
  latestJobId: string | null;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NgoFilter {
  city?: string;
  area?: string;
  cause?: string;
  search?: string;
  status?: ContactStatus;
  interest?: InterestStatus;
  darpan?: "verified" | "unverified";
  inCrm?: boolean;
  audited?: boolean;
  source?: NgoSource;
  priority?: Priority;
  category?: string;
  meeting?: boolean;
}

export interface NgoPatch extends Partial<Profile> {
  contactStatus?: ContactStatus;
  interestStatus?: InterestStatus;
  inCrm?: boolean;
  notes?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  followUpAt?: string | null;
  meetingScheduled?: boolean;
  meetingAt?: string | null;
  /** Date of the last contact (set automatically on first contact; editable). */
  contactedAt?: string | null;
  cause?: string | null;
  area?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** Input for adding directory entries (starter list, search-discovered, manual). Never carries invented facts. */
export interface DirectoryEntry extends Partial<Profile> {
  name: string;
  city: string;
  area?: string;
  cause?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  geoBasis?: string;
  website?: string;
  phone?: string;
  email?: string;
  darpanId?: string;
  darpanStatus?: DarpanStatus;
  sourceNote?: string;
  source: NgoSource;
  /** Starting pipeline state when an import already records it (e.g. a "Contacted" column). */
  contactStatus?: ContactStatus;
  interestStatus?: InterestStatus;
  contactedAt?: string;
}

export interface CrmNoteView { id: string; ngoId: string; content: string; author: string; createdAt: string }

import { locationLabel } from "@/lib/geo/areas";

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase();

/** Pure filter: used by the stores and by the client for instant, as-you-type search. */
export function matchesFilter(r: NgoRecord, f: NgoFilter): boolean {
  if (f.city && f.city !== "all" && norm(r.city) !== norm(f.city)) return false;
  if (f.area && f.area !== "all" && norm(r.area) !== norm(f.area)) return false;
  if (f.cause && f.cause !== "all" && !norm(r.cause).split(";").some((c) => c.trim() === norm(f.cause))) return false;
  if (f.status && r.contactStatus !== f.status) return false;
  if (f.interest && r.interestStatus !== f.interest) return false;
  if (f.inCrm !== undefined && r.inCrm !== f.inCrm) return false;
  if (f.audited !== undefined && r.audited !== f.audited) return false;
  if (f.source && r.source !== f.source) return false;
  if (f.meeting !== undefined && r.meetingScheduled !== f.meeting) return false;
  if (f.priority && (r.priority ?? "") !== f.priority) return false;
  if (f.category && f.category !== "all" && !categoriesOf(r).includes(f.category as Category)) return false;
  if (f.darpan === "verified" && r.darpanStatus !== "VERIFIED") return false;
  if (f.darpan === "unverified" && r.darpanStatus === "VERIFIED") return false;
  const q = norm(f.search).trim();
  if (q && ![r.name, r.cause, r.area, r.city, r.notes, r.contactPerson, r.organisationType, r.phone, r.email].some((x) => norm(x).includes(q))) return false;
  return true;
}

export function isContactStatus(v: unknown): v is ContactStatus { return typeof v === "string" && (CONTACT_STATUSES as readonly string[]).includes(v); }
export function isInterestStatus(v: unknown): v is InterestStatus { return typeof v === "string" && (INTEREST_STATUSES as readonly string[]).includes(v); }

/** Adds `contactedAt` bookkeeping: set on first contact, cleared when reset to NOT_CONTACTED. */
export function contactedAtFor(prev: { contactStatus: ContactStatus; contactedAt: string | null }, next: ContactStatus | undefined, now: string): string | null {
  if (!next || next === prev.contactStatus) return prev.contactedAt;
  if (next === "NOT_CONTACTED") return null;
  return prev.contactedAt ?? now;
}

/**
 * Phone cells are stored exactly as typed and may hold several numbers ("98xxxxxx01 / 99xxxxxx02").
 * These helpers pick the first dialable number and never "repair" digits.
 */
export function phoneParts(phone: string | null | undefined): string[] {
  return (phone ?? "").split(/[\/;,\n]|\s{2,}|\bor\b/i).map((x) => x.trim()).filter((x) => x.replace(/\D/g, "").length >= 5);
}

/** Digits of one number normalised for dialling (India default). Returns null when it is not a plausible number. */
export function dialDigits(part: string): string | null {
  const d = part.replace(/\D/g, "");
  if (part.trim().startsWith("+")) return d.length >= 8 && d.length <= 15 ? d : null;
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`; // STD-coded landline, e.g. 040-27700927
  if (d.length === 12 && d.startsWith("91")) return d;
  return null;
}

/** True when a number is present but its first entry does not look dialable (e.g. 11 digits that do not start with 0) — shown as "check this number". */
export function phoneNeedsCheck(phone: string | null | undefined): boolean {
  const parts = phoneParts(phone);
  if (!parts.length) return !!(phone ?? "").trim();
  return parts.some((p) => dialDigits(p) === null);
}

export function telHref(phone: string | null | undefined): string | null {
  for (const p of phoneParts(phone)) { const d = dialDigits(p); if (d) return `tel:+${d}`; }
  return null;
}

/** wa.me link for the first number that looks like a mobile (or any international +number). Returns null if none does. */
export function whatsappHref(phone: string | null | undefined, text?: string): string | null {
  for (const p of phoneParts(phone)) {
    const d = dialDigits(p);
    if (d && (/^91[6-9]\d{9}$/.test(d) || p.trim().startsWith("+"))) return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
  }
  return null;
}

/** Human-readable activity lines for a patch (stored as CRM activity notes). */
export function changeLines(prev: Pick<NgoRecord, "contactStatus" | "interestStatus" | "inCrm"> & Partial<Pick<NgoRecord, "meetingScheduled" | "meetingAt">>, patch: NgoPatch): string[] {
  const out: string[] = [];
  if (patch.contactStatus && patch.contactStatus !== prev.contactStatus) out.push(`Contact status: ${CONTACT_LABEL[prev.contactStatus]} → ${CONTACT_LABEL[patch.contactStatus]}`);
  if (patch.interestStatus && patch.interestStatus !== prev.interestStatus) out.push(`Interest: ${INTEREST_LABEL[prev.interestStatus]} → ${INTEREST_LABEL[patch.interestStatus]}`);
  if (patch.inCrm !== undefined && patch.inCrm !== prev.inCrm) out.push(patch.inCrm ? "Added to Outreach CRM" : "Removed from Outreach CRM");
  if (patch.meetingAt && patch.meetingAt !== prev.meetingAt) out.push(`Meeting scheduled for ${patch.meetingAt.slice(0, 16).replace("T", " ")} (UTC)`);
  else if (patch.meetingScheduled !== undefined && patch.meetingScheduled !== prev.meetingScheduled) out.push(patch.meetingScheduled ? "Meeting scheduled" : "Meeting cancelled / not scheduled");
  return out;
}

export const NOTE_MAX = 4000;

/** Apply a patch to a record the same way the stores do (used for optimistic UI updates). */
export function applyPatchLocal(r: NgoRecord, p: NgoPatch, now: string): NgoRecord {
  const next: NgoRecord = { ...r, updatedAt: now };
  next.contactedAt = p.contactedAt !== undefined ? p.contactedAt : contactedAtFor(r, p.contactStatus, now);
  if (p.contactStatus) next.contactStatus = p.contactStatus;
  if (p.interestStatus) next.interestStatus = p.interestStatus;
  if (p.inCrm !== undefined) next.inCrm = p.inCrm;
  if (p.notes !== undefined) next.notes = p.notes;
  if (p.phone !== undefined) next.phone = p.phone;
  if (p.email !== undefined) next.email = p.email;
  if (p.website !== undefined) next.website = p.website;
  if (p.followUpAt !== undefined) next.followUpAt = p.followUpAt;
  if (p.meetingAt !== undefined) { next.meetingAt = p.meetingAt; if (p.meetingAt) next.meetingScheduled = true; }
  if (p.meetingScheduled !== undefined) { next.meetingScheduled = p.meetingScheduled; if (!p.meetingScheduled) next.meetingAt = null; }
  for (const k of PROFILE_KEYS) if (p[k] !== undefined) next[k] = p[k] as string | null;
  if (p.cause !== undefined) next.cause = p.cause;
  if (p.address !== undefined) next.address = p.address;
  if (p.latitude !== undefined) next.latitude = p.latitude;
  if (p.longitude !== undefined) next.longitude = p.longitude;
  if (p.area !== undefined) { next.area = p.area; next.location = locationLabel(next.area, next.city); }
  return next;
}

export const TWIN_CITIES = ["Hyderabad", "Secunderabad"] as const;

/** Distinct values for the filter dropdowns, taken from the data itself (never hard-coded). */
export function facetsOf(records: NgoRecord[]) {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  return {
    cities: uniq(records.map((r) => r.city)),
    areas: uniq(records.map((r) => r.area)),
    // a cause may hold several sectors separated by ";" — offer each sector once
    categories: CATEGORIES.map((c) => ({ name: c, count: records.filter((r) => categoriesOf(r).includes(c)).length })).filter((c) => c.count > 0),
    priorities: PRIORITIES.filter((p) => records.some((r) => r.priority === p)) as string[],
    causes: uniq(records.flatMap((r) => (r.cause ? r.cause.split(";").map((c) => c.trim()) : []))),
  };
}
