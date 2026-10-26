"use client";

import * as React from "react";
import Link from "next/link";
import {
  Accessibility, AlertTriangle, Baby, Briefcase, CheckCircle2, ExternalLink, GraduationCap, HandHeart, HeartHandshake, HeartPulse, House, Leaf, LoaderCircle,
  Palette, PawPrint, Pencil, Phone, Plus, StickyNote, Venus,
} from "lucide-react";
import {
  CATEGORIES, categoriesOf, CONTACT_LABEL, CONTACT_STATUSES, DARPAN_LABEL, NOTE_MAX, type Category, dialDigits, INTEREST_LABEL, INTEREST_STATUSES, phoneNeedsCheck, phoneParts, WEBSITE_LABEL,
  type ContactStatus, type InterestStatus, type NgoRecord,
} from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { STAGES } from "@/lib/research/store";
import { useNgoData, type AuditRun } from "./ngo-data";

export const CONTACT_PILL: Record<ContactStatus, string> = { NOT_CONTACTED: "pill-warn", CONTACTED: "pill-ok", FOLLOW_UP_SCHEDULED: "pill-info" };
export const INTEREST_PILL: Record<InterestStatus, string> = { PENDING: "pill-muted", INTERESTED: "pill-ok", UNINTERESTED: "pill-bad", CONTRACT_SIGNED: "pill-gold" };

export function ContactBadge({ status, className }: { status: ContactStatus; className?: string }) {
  return <span className={cn("pill", CONTACT_PILL[status], className)}>{CONTACT_LABEL[status]}</span>;
}

export function CityTag({ record }: { record: Pick<NgoRecord, "city" | "area"> }) {
  if (!record.city && !record.area) return <span className="text-xs text-muted-foreground">No location</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {record.city && <span className="pill pill-gold">{record.city}</span>}
      {record.area && <span className="text-xs text-muted-foreground">{record.area}</span>}
    </span>
  );
}

export function DarpanBadge({ record }: { record: Pick<NgoRecord, "darpanStatus" | "darpanId" | "sourceNote"> }) {
  if (record.darpanStatus === "VERIFIED") {
    return <span className="pill pill-ok" title={`${DARPAN_LABEL.VERIFIED}${record.darpanId ? ` · registration no. ${record.darpanId}` : ""}${record.sourceNote ? ` · ${record.sourceNote}` : ""}`}><CheckCircle2 className="size-3" aria-hidden /> Darpan listed</span>;
  }
  return <span className="pill pill-muted" title={DARPAN_LABEL[record.darpanStatus]}>{record.darpanStatus === "UNVERIFIED" ? "Darpan: unverified" : record.darpanStatus === "NOT_FOUND" ? "Darpan: not found" : "Darpan: unchecked"}</span>;
}

/** Instant toggle: ticked = contacted. Writes through the shared store so every view updates together. */
export function ContactCheckbox({ record }: { record: NgoRecord }) {
  const { patch } = useNgoData();
  const checked = record.contactStatus !== "NOT_CONTACTED";
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox" className="size-4 accent-[var(--ok)]" checked={checked}
        onChange={(e) => void patch(record.id, { contactStatus: e.target.checked ? "CONTACTED" : "NOT_CONTACTED" })}
        aria-label={`${record.name}: contacted`}
      />
      <span className="sr-only sm:not-sr-only sm:text-xs sm:text-muted-foreground">{checked ? "Contacted" : "Not yet"}</span>
    </label>
  );
}

const selectCls = "h-8 rounded-md border border-input bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ContactSelect({ record }: { record: NgoRecord }) {
  const { patch } = useNgoData();
  return (
    <select aria-label={`${record.name}: contact status`} value={record.contactStatus} onChange={(e) => void patch(record.id, { contactStatus: e.target.value as ContactStatus })} className={cn(selectCls, "pill !h-8 !rounded-md", CONTACT_PILL[record.contactStatus])}>
      {CONTACT_STATUSES.map((s) => <option key={s} value={s}>{CONTACT_LABEL[s]}</option>)}
    </select>
  );
}

export function InterestSelect({ record }: { record: NgoRecord }) {
  const { patch } = useNgoData();
  return (
    <select aria-label={`${record.name}: interest`} value={record.interestStatus} onChange={(e) => void patch(record.id, { interestStatus: e.target.value as InterestStatus })} className={cn(selectCls, "pill !h-8 !rounded-md", INTEREST_PILL[record.interestStatus])}>
      {INTEREST_STATUSES.map((s) => <option key={s} value={s}>{INTEREST_LABEL[s]}</option>)}
    </select>
  );
}

const inputCls = "h-8 rounded-md border border-input bg-card px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const editBtn = "rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Click-to-call links (one per number) with an inline editor. Saves on Enter or blur. Numbers are shown exactly as stored. */
export function PhoneCell({ record, editable = true }: { record: NgoRecord; editable?: boolean }) {
  const { patch, toast } = useNgoData();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(record.phone ?? "");
  const parts = phoneParts(record.phone);
  const check = phoneNeedsCheck(record.phone);

  async function commit() {
    setEditing(false);
    const next = value.trim();
    if (next === (record.phone ?? "")) return;
    if (next && !/^[+\d][\d\s().\-/,;+]*$/.test(next)) { toast("That phone number does not look valid.", "error"); setValue(record.phone ?? ""); return; }
    await patch(record.id, { phone: next || null });
  }

  if (editing) {
    return (
      <input
        autoFocus type="tel" inputMode="tel" value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit} maxLength={80}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setValue(record.phone ?? ""); setEditing(false); } }}
        aria-label={`${record.name}: phone number`} placeholder="+91 …  (separate several with /)" className={`${inputCls} w-44`}
      />
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {record.phone ? (
        <span className="inline-flex flex-wrap items-center gap-x-1">
          {parts.length ? parts.map((p, i) => {
            const d = dialDigits(p);
            return (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-muted-foreground" aria-hidden>/</span>}
                {d ? <a href={`tel:+${d}`} className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline">{i === 0 && <Phone className="size-3.5" aria-hidden />}{p}</a> : <span className="text-sm">{p}</span>}
              </React.Fragment>
            );
          }) : <span className="text-sm">{record.phone}</span>}
          {check && <span className="pill pill-warn" title="This number does not look complete (for example it has an extra digit). It is shown exactly as listed — edit it once you have confirmed the right number.">check</span>}
        </span>
      ) : <span className="text-sm text-muted-foreground">—</span>}
      {editable && (
        <button type="button" onClick={() => { setValue(record.phone ?? ""); setEditing(true); }} className={editBtn} aria-label={`${record.phone ? "Edit" : "Add"} phone for ${record.name}`}>
          {record.phone ? <Pencil className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
        </button>
      )}
    </span>
  );
}

/** Website link with an inline editor. Saves on Enter or blur; the server tidies the address and rejects anything that is not http(s). */
export function WebsiteCell({ record, editable = true }: { record: NgoRecord; editable?: boolean }) {
  const { patch, toast } = useNgoData();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(record.website ?? "");

  async function commit() {
    setEditing(false);
    const next = value.trim();
    if (next === (record.website ?? "")) return;
    if (next && (/\s/.test(next) || !next.includes("."))) { toast("That website address does not look valid.", "error"); setValue(record.website ?? ""); return; }
    await patch(record.id, { website: next || null });
  }

  if (editing) {
    return (
      <input
        autoFocus type="url" inputMode="url" value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit} maxLength={300}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setValue(record.website ?? ""); setEditing(false); } }}
        aria-label={`${record.name}: website`} placeholder="example.org" className={`${inputCls} w-48`}
      />
    );
  }
  const pencil = editable && (
    <button type="button" onClick={() => { setValue(record.website ?? ""); setEditing(true); }} className={editBtn} aria-label={`${record.website ? "Edit" : "Add"} website for ${record.name}`}>
      {record.website ? <Pencil className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
    </button>
  );
  if (record.website) {
    return (
      <span className="inline-flex items-center gap-1">
        <a href={record.website} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[12rem] items-center gap-1 truncate text-sm underline-offset-2 hover:underline">
          <span className="truncate">{record.website.replace(/^https?:\/\/(www\.)?/, "")}</span><ExternalLink className="size-3 shrink-0" aria-hidden />
        </a>{pencil}
      </span>
    );
  }
  if (record.websiteStatus === "NOT_FOUND_PUBLICLY") {
    return <span className="inline-flex items-center gap-1"><span className="pill pill-warn" title="An audit looked for an official website in the sources checked and did not find one. It may still exist."><AlertTriangle className="size-3" aria-hidden /> Not found publicly</span>{pencil}</span>;
  }
  return <span className="inline-flex items-center gap-1"><span className="text-xs text-muted-foreground" title="No website on record. Add one, or run a Deep Audit to look for it.">None on record</span>{pencil}</span>;
}

export function PriorityPill({ priority }: { priority: string | null }) {
  if (!priority) return null;
  const cls = priority === "High" ? "pill-gold" : priority === "Medium" ? "pill-info" : "pill-muted";
  return <span className={cn("pill", cls)} title="Outreach priority from your list (editable)">{priority} priority</span>;
}

export function WebsiteStatusPill({ record }: { record: NgoRecord }) {
  const cls = record.websiteStatus === "REACHABLE" ? "pill-ok" : record.websiteStatus === "NOT_FOUND_PUBLICLY" ? "pill-warn" : record.websiteStatus === "UNABLE_TO_ASSESS" ? "pill-muted" : "pill-muted";
  return <span className={cn("pill", cls)}>{WEBSITE_LABEL[record.websiteStatus]}</span>;
}

export function ScorePills({ record }: { record: NgoRecord }) {
  const r = record.readinessScore;
  const rc = r === null ? "pill-muted" : r >= 70 ? "pill-ok" : r >= 40 ? "pill-warn" : "pill-bad";
  return (
    <span className="inline-flex flex-wrap gap-1">
      <span className={cn("pill", rc)} title="Observable digital readiness only — not the quality of their work.">Readiness {r === null ? "— not enough evidence" : r}</span>
      <span className="pill pill-gold" title="Internal prospect priority. Never shown to the NGO.">Opportunity {record.opportunityScore ?? "—"}</span>
    </span>
  );
}

export function RunChip({ run }: { run: AuditRun | undefined }) {
  if (!run) return null;
  const label = STAGES.find((s) => s.id === run.stage)?.label;
  if (run.status === "QUEUED" || run.status === "RUNNING") {
    return <Link href={`/jobs/${run.jobId}`} className="pill pill-info" title={label ?? "Waiting for a free slot"}><LoaderCircle className="size-3 animate-spin" aria-hidden /> {run.status === "QUEUED" ? "Queued" : `Auditing ${run.progress}%`}</Link>;
  }
  if (run.status === "AWAITING_DISAMBIGUATION") return <Link href={`/jobs/${run.jobId}`} className="pill pill-warn">Needs your choice</Link>;
  if (run.status === "FAILED") return <Link href={`/jobs/${run.jobId}`} className="pill pill-bad">Audit failed — view</Link>;
  return null;
}

export function SourceChip({ record }: { record: NgoRecord }) {
  const label = record.source === "STARTER" ? "Starter list" : record.source === "IMPORT" ? "Your spreadsheet" : record.source === "DISCOVERED" ? "Search-found" : record.source === "MANUAL" ? "Added by hand" : "Searched";
  return <span className="pill pill-muted" title={record.sourceNote ?? undefined}>{label}</span>;
}

const CATEGORY_ICON: Record<Category, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  Animals: PawPrint, Elderly: HeartHandshake, Children: Baby, Education: GraduationCap, "Shelter & homes": House, Women: Venus, Health: HeartPulse,
  Disability: Accessibility, Environment: Leaf, "Livelihoods & skills": Briefcase, "Arts & culture": Palette, "Social development": HandHeart,
};

const CATEGORY_COLOR: Record<Category, string> = {
  Animals: "#d97706", Elderly: "#7c3aed", Children: "#0ea5e9", Education: "#2563eb", "Shelter & homes": "#0d9488", Women: "#db2777", Health: "#dc2626",
  Disability: "#4f46e5", Environment: "#16a34a", "Livelihoods & skills": "#a16207", "Arts & culture": "#c026d3", "Social development": "#64748b",
};

/** Category pills (Animals, Children, Elderly…) derived from the NGO's cause; the exact wording is in the tooltip. */
export function CategoryPills({ record, max = 3 }: { record: Pick<NgoRecord, "cause" | "name" | "whatTheyDo" | "beneficiaries">; max?: number }) {
  const cats = categoriesOf(record);
  if (!cats.length) return <span className="text-xs text-muted-foreground">Not set</span>;
  return (
    <span className="inline-flex flex-wrap gap-1" title={record.cause ? `Listed as: ${record.cause}` : undefined}>
      {cats.slice(0, max).map((c) => { const I = CATEGORY_ICON[c]; return <span key={c} className="cat-pill" style={{ ["--c" as string]: CATEGORY_COLOR[c] }}><I className="size-3" aria-hidden />{c}</span>; })}
      {cats.length > max && <span className="pill pill-muted">+{cats.length - max}</span>}
    </span>
  );
}

/** Category column: pills plus an inline editor for the underlying cause text (suggestions offered). */
export function CategoryCell({ record }: { record: NgoRecord }) {
  const { patch } = useNgoData();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(record.cause ?? "");
  async function commit() {
    setEditing(false);
    const next = value.trim().slice(0, 160);
    if (next === (record.cause ?? "")) return;
    await patch(record.id, { cause: next || null });
  }
  if (editing) {
    return (
      <span>
        <input autoFocus list="category-suggestions" value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit} maxLength={160}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setValue(record.cause ?? ""); setEditing(false); } }}
          aria-label={`${record.name}: category`} placeholder="e.g. Animals, Elderly" className={`${inputCls} w-44`} />
        <datalist id="category-suggestions">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
      </span>
    );
  }
  return (
    <span className="inline-flex items-start gap-1">
      <CategoryPills record={record} max={2} />
      <button type="button" onClick={() => { setValue(record.cause ?? ""); setEditing(true); }} className={editBtn} aria-label={`Edit category for ${record.name}`}>
        <Pencil className="size-3" aria-hidden />
      </button>
    </span>
  );
}

/** Notes right in the row: click to write, saves when you click away (Esc cancels, Ctrl/⌘+Enter saves). */
export function NotesCell({ record, wide = false }: { record: NgoRecord; wide?: boolean }) {
  const { patch } = useNgoData();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(record.notes ?? "");
  const [saved, setSaved] = React.useState(false);
  async function commit() {
    setEditing(false);
    const next = value.trim() ? value : "";
    if (next === (record.notes ?? "")) return;
    const ok = await patch(record.id, { notes: next || null });
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 1500); }
  }
  if (editing) {
    return (
      <textarea autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit} rows={wide ? 4 : 3} maxLength={NOTE_MAX}
        onKeyDown={(e) => { if (e.key === "Escape") { setValue(record.notes ?? ""); setEditing(false); } if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur(); }}
        aria-label={`${record.name}: notes`} placeholder="Call notes, who you spoke to, what's next…"
        className={cn("rounded-md border border-input bg-card p-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", wide ? "w-full" : "w-56")} />
    );
  }
  return (
    <button type="button" onClick={() => { setValue(record.notes ?? ""); setEditing(true); }} aria-label={`${record.notes ? "Edit" : "Add"} notes for ${record.name}`}
      className={cn("group flex items-start gap-1.5 rounded-md px-1 py-0.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", wide ? "w-full" : "max-w-[14rem]")}>
      <StickyNote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {record.notes
        ? <span className="line-clamp-3 whitespace-pre-line">{record.notes}</span>
        : <span className="text-muted-foreground group-hover:text-foreground">Add a note</span>}
      {saved && <span className="ml-auto shrink-0 text-[var(--ok-ink)]" aria-live="polite">Saved</span>}
    </button>
  );
}

/** "2026-10-24T15:30" for a datetime-local input, in the viewer's local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function formatMeeting(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Meeting scheduled (Yes/No) + meeting time. Picking a time sets "Yes"; choosing "No" clears the time. */
export function MeetingCell({ record, stacked = true }: { record: NgoRecord; stacked?: boolean }) {
  const { patch } = useNgoData();
  const [now] = React.useState(() => Date.now());
  const upcoming = !!record.meetingAt && new Date(record.meetingAt).getTime() > now;
  return (
    <div className={cn("flex gap-1.5", stacked ? "flex-col items-start" : "flex-wrap items-center")}>
      <select aria-label={`${record.name}: meeting scheduled`} value={record.meetingScheduled ? "yes" : "no"}
        onChange={(e) => void patch(record.id, { meetingScheduled: e.target.value === "yes" })}
        className={cn(selectCls, "pill !h-8 !rounded-md", record.meetingScheduled ? "pill-info" : "pill-muted")}>
        <option value="no">Meeting: No</option>
        <option value="yes">Meeting: Yes</option>
      </select>
      <input type="datetime-local" aria-label={`${record.name}: meeting time`} value={toLocalInput(record.meetingAt)}
        onChange={(e) => void patch(record.id, { meetingAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
        className={cn("h-8 w-[11.5rem] rounded-md border border-input bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", !record.meetingAt && "text-muted-foreground")} />
      {record.meetingAt && <span className={cn("text-[11px]", upcoming ? "font-medium text-[var(--info-ink)]" : "text-muted-foreground")}>{upcoming ? "Upcoming · " : "Was · "}{formatMeeting(record.meetingAt)}</span>}
    </div>
  );
}
