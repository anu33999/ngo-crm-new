"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Copy, Download, FileText, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorBox, Skeleton } from "@/components/shared";
import { api } from "@/lib/client/api";
import { CONTACT_LABEL, CONTACT_STATUSES, INTEREST_LABEL, INTEREST_STATUSES, matchesFilter, type ContactStatus, type InterestStatus, type NgoFilter, type NgoRecord } from "@/lib/crm/types";
import type { NgoPayload } from "@/lib/server/view";
import { useNgoData } from "./ngo-data";
import { CategoryPills, CityTag, ContactSelect, InterestSelect, MeetingCell, NotesCell, PhoneCell, PriorityPill, RunChip, WebsiteCell } from "./parts";
import { DetailsPanel } from "./details-panel";
import { PageHeader, selectCls, StatStrip } from "./page-header";
import { PitchModal } from "./pitch-modal";

export function CrmView() {
  const { records, loaded, error, refresh, bulk, patch, audit, runs, toast } = useNgoData();
  const inCrmCount = React.useMemo(() => records.filter((r) => r.inCrm).length, [records]);
  const [scopeChoice, setScope] = React.useState<"crm" | "all" | null>(null);
  // Until you pick, show your CRM if it has anyone in it, otherwise every NGO — so this page is never a dead end.
  const scope = scopeChoice ?? (inCrmCount > 0 ? "crm" : "all");
  const mine = React.useMemo(() => (scope === "crm" ? records.filter((r) => r.inCrm) : records), [records, scope]);
  const [search, setSearch] = React.useState("");
  const [contact, setContact] = React.useState<"all" | ContactStatus>("all");
  const [interest, setInterest] = React.useState<"all" | InterestStatus>("all");
  const [city, setCity] = React.useState("all");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const [pitchFor, setPitchFor] = React.useState<string | null>(null);

  const filter: NgoFilter = React.useMemo(() => ({ search, city, status: contact === "all" ? undefined : contact, interest: interest === "all" ? undefined : interest }), [search, city, contact, interest]);
  const rows = React.useMemo(() => mine.filter((r) => matchesFilter(r, filter)).sort((a, b) => a.name.localeCompare(b.name)), [mine, filter]);
  const cities = React.useMemo(() => [...new Set(mine.map((r) => r.city).filter((c): c is string => !!c))].sort(), [mine]);
  const count = (f: (r: NgoRecord) => boolean) => mine.filter(f).length;

  const chosen = React.useMemo(() => rows.filter((r) => selected.has(r.id)).map((r) => r.id), [rows, selected]);
  const allSel = rows.length > 0 && chosen.length === rows.length;
  const headRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (headRef.current) headRef.current.indeterminate = chosen.length > 0 && !allSel; }, [chosen.length, allSel]);
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  const pitchRecord = pitchFor ? mine.find((r) => r.id === pitchFor) ?? records.find((r) => r.id === pitchFor) : undefined;

  async function copyWhatsApp(r: NgoRecord) {
    if (!r.audited) { toast("Run a Deep Audit first — there is no pitch to copy yet.", "info"); return; }
    try {
      const p = await api<NgoPayload>(`/api/ngos/${r.id}`);
      const d = p.pitches[0]?.drafts.find((x) => x.channel === "WHATSAPP");
      if (!d) { toast("No WhatsApp draft yet — generate one on the audit page.", "info"); return; }
      const text = d.editedBody ?? d.body;
      try { await navigator.clipboard.writeText(text); }
      catch { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
      toast(`WhatsApp pitch for ${r.name} copied. Review it before you send.`);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not copy the pitch.", "error"); }
  }

  const exportHref = (format: string) => `/api/export?format=${format}${city !== "all" ? `&city=${encodeURIComponent(city)}` : ""}${contact !== "all" ? `&status=${contact}` : ""}${interest !== "all" ? `&interest=${interest}` : ""}${search ? `&search=${encodeURIComponent(search)}` : ""}`;

  const tiles: { label: string; value: number; apply: () => void; active: boolean; tone: "gold" | "warn" | "ok" | "info" | "bad" }[] = [
    { label: scope === "crm" ? "In your CRM" : "All NGOs", tone: "gold", value: mine.length, apply: () => { setContact("all"); setInterest("all"); }, active: contact === "all" && interest === "all" },
    { label: "Not contacted", tone: "warn", value: count((r) => r.contactStatus === "NOT_CONTACTED"), apply: () => { setContact("NOT_CONTACTED"); setInterest("all"); }, active: contact === "NOT_CONTACTED" },
    { label: "Contacted", tone: "ok", value: count((r) => r.contactStatus === "CONTACTED"), apply: () => { setContact("CONTACTED"); setInterest("all"); }, active: contact === "CONTACTED" },
    { label: "Follow-up scheduled", tone: "info", value: count((r) => r.contactStatus === "FOLLOW_UP_SCHEDULED"), apply: () => { setContact("FOLLOW_UP_SCHEDULED"); setInterest("all"); }, active: contact === "FOLLOW_UP_SCHEDULED" },
    { label: "Interested", tone: "ok", value: count((r) => r.interestStatus === "INTERESTED"), apply: () => { setInterest("INTERESTED"); setContact("all"); }, active: interest === "INTERESTED" },
    { label: "Contracts signed", tone: "gold", value: count((r) => r.interestStatus === "CONTRACT_SIGNED"), apply: () => { setInterest("CONTRACT_SIGNED"); setContact("all"); }, active: interest === "CONTRACT_SIGNED" },
  ];

  return (
    <div>
      <PageHeader eyebrow="Outreach pipeline & CRM" title="My searched NGOs"
        actions={<>
          <Button asChild variant="outline" size="sm"><a href={exportHref("csv")}><Download className="size-4" aria-hidden /> CSV</a></Button>
          <Button asChild variant="outline" size="sm"><a href={exportHref("xlsx")}><Download className="size-4" aria-hidden /> Excel</a></Button>
          <Button asChild variant="outline" size="sm"><a href={exportHref("pdf")}><Download className="size-4" aria-hidden /> PDF</a></Button>
        </>}>
        Every NGO you add from Discovery or History lands here. Change a status once and it updates on the map and in Discovery too.
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-border bg-card p-1 shadow-[var(--shadow-soft)]" role="group" aria-label="Which NGOs to show">
          <button type="button" aria-pressed={scope === "crm"} onClick={() => setScope("crm")} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${scope === "crm" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>My CRM ({inCrmCount})</button>
          <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${scope === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>All NGOs ({records.length})</button>
        </div>
        <p className="text-xs text-muted-foreground">{scope === "crm" ? "NGOs you added to your pipeline." : inCrmCount === 0 ? "Your CRM is empty, so every NGO is shown — tick rows and use “Add to CRM” to build your pipeline." : "Every NGO in the app. Rows already in your CRM are marked."}</p>
      </div>
      <StatStrip items={tiles.map((t) => ({ label: t.label, value: t.value, tone: t.tone, onClick: t.apply, active: t.active }))} />

      <div className="grid gap-3 sm:grid-cols-[1fr_11rem_11rem_11rem]">
        <div className="relative">
          <label htmlFor="c-search" className="sr-only">Search your CRM</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="c-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, cause, area or notes…" className="pl-9" autoComplete="off" />
        </div>
        <div><label htmlFor="c-city" className="sr-only">Location</label><select id="c-city" value={city} onChange={(e) => setCity(e.target.value)} className={`${selectCls} w-full`}><option value="all">All locations</option>{cities.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label htmlFor="c-contact" className="sr-only">Contact status</label><select id="c-contact" value={contact} onChange={(e) => setContact(e.target.value as typeof contact)} className={`${selectCls} w-full`}><option value="all">Any contact status</option>{CONTACT_STATUSES.map((s) => <option key={s} value={s}>{CONTACT_LABEL[s]}</option>)}</select></div>
        <div><label htmlFor="c-interest" className="sr-only">Interest</label><select id="c-interest" value={interest} onChange={(e) => setInterest(e.target.value as typeof interest)} className={`${selectCls} w-full`}><option value="all">Any interest</option>{INTEREST_STATUSES.map((s) => <option key={s} value={s}>{INTEREST_LABEL[s]}</option>)}</select></div>
      </div>

      <div className="sticky top-[3.6rem] z-30 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/90 p-2.5 shadow-[var(--shadow-soft)] backdrop-blur" role="toolbar" aria-label="Actions for selected NGOs">
        <span className="px-1 text-sm tabular-nums" aria-live="polite">{chosen.length ? `${chosen.length} selected` : `${rows.length} shown`}</span>
        <Button size="sm" variant="outline" disabled={!chosen.length} onClick={() => void bulk(chosen, { contactStatus: "CONTACTED" }, `Marked ${chosen.length} as contacted.`)}>Mark contacted</Button>
        <Button size="sm" variant="outline" disabled={!chosen.length} onClick={() => void bulk(chosen, { interestStatus: "INTERESTED" }, `Marked ${chosen.length} as interested.`)}>Mark interested</Button>
        <Button size="sm" variant="outline" disabled={!chosen.length} onClick={() => void audit(chosen.filter((id) => !records.find((r) => r.id === id)?.audited))}>Run deep audit</Button>
        {scope === "all" && <Button size="sm" disabled={!chosen.length} onClick={() => void bulk(chosen, { inCrm: true }, `Added ${chosen.length} to the CRM.`)}>Add to CRM</Button>}
        <Button size="sm" variant="ghost" disabled={!chosen.length} onClick={() => { void bulk(chosen, { inCrm: false }, `Removed ${chosen.length} from the CRM.`); setSelected(new Set()); }}><Trash2 className="size-4" aria-hidden /> Remove from CRM</Button>
      </div>

      {error && <div className="mt-4"><ErrorBox message={error} onRetry={refresh} /></div>}
      {!loaded && !error && <div className="mt-4 space-y-2" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>}
      {loaded && mine.length === 0 && <div className="mt-4"><EmptyState title="Your CRM is empty">Open <Link href="/discovery" className="underline underline-offset-2">Discovery</Link>, tick the NGOs you want to pursue and choose <em>Add selected to Outreach CRM</em>. NGOs you search for by name can be added from <Link href="/history" className="underline underline-offset-2">History</Link>.</EmptyState></div>}
      {loaded && mine.length > 0 && rows.length === 0 && <div className="mt-4"><EmptyState title="No NGO in your CRM matches those filters" /></div>}

      {rows.length > 0 && (
        <div className="mt-4 table-shell">
          <table className="w-full min-w-[96rem] text-left text-sm">
            <caption className="sr-only">Outreach pipeline</caption>
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 p-3"><input ref={headRef} type="checkbox" className="size-4" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all shown NGOs" /></th>
                <th scope="col" className="p-3 font-medium">NGO</th>
                <th scope="col" className="p-3 font-medium">Website</th>
                <th scope="col" className="p-3 font-medium">Phone</th>
                <th scope="col" className="p-3 font-medium">Contact</th>
                <th scope="col" className="p-3 font-medium">Interest</th>
                <th scope="col" className="p-3 font-medium">Meeting</th>
                <th scope="col" className="min-w-[13rem] p-3 font-medium">Notes</th>
                <th scope="col" className="p-3 font-medium">Pitch summary</th>
                <th scope="col" className="p-3 font-medium">Quick actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = open.has(r.id);
                return (
                  <React.Fragment key={r.id}>
                    <tr className={`border-t border-border align-top ${selected.has(r.id) ? "bg-accent/15" : ""}`}>
                      <td className="p-3"><input type="checkbox" className="size-4" checked={selected.has(r.id)} onChange={() => setSelected((s) => toggle(s, r.id))} aria-label={`Select ${r.name}`} /></td>
                      <td className="max-w-[16rem] p-3">
                        <p className="font-medium">{r.audited ? <Link href={`/ngo/${r.id}`} className="underline-offset-2 hover:underline">{r.name}</Link> : r.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1"><CityTag record={r} /><PriorityPill priority={r.priority} />{scope === "all" && r.inCrm && <span className="pill pill-info">In CRM</span>}</div>
                        <div className="mt-1"><CategoryPills record={r} max={2} /></div>
                        {r.contactPerson && <p className="mt-1 text-xs text-muted-foreground">{r.contactPerson}{r.designation ? `, ${r.designation}` : ""}</p>}
                        <button onClick={() => setOpen((s) => toggle(s, r.id))} aria-expanded={isOpen} className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {isOpen ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />} Details &amp; notes{r.notes ? " ●" : ""}{r.noteCount ? ` · ${r.noteCount} activity` : ""}
                        </button>
                      </td>
                      <td className="p-3"><WebsiteCell record={r} /></td>
                      <td className="p-3"><PhoneCell record={r} /></td>
                      <td className="p-3"><ContactSelect record={r} /></td>
                      <td className="p-3"><InterestSelect record={r} /></td>
                      <td className="p-3"><MeetingCell record={r} /></td>
                      <td className="p-3"><NotesCell record={r} /></td>
                      <td className="max-w-[16rem] p-3">
                        {r.pitchSummary
                          ? <button onClick={() => setPitchFor(r.id)} className="text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="line-clamp-2 whitespace-pre-line">{r.pitchSummary}</span><span className="mt-0.5 block underline underline-offset-2">View all formats</span></button>
                          : <span className="text-xs text-muted-foreground">{runs[r.id] ? <RunChip run={runs[r.id]} /> : "No pitch yet — run a deep audit."}</span>}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-col items-start gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => void copyWhatsApp(r)}><Copy className="size-4" aria-hidden /> Copy WhatsApp pitch</Button>
                          {r.audited
                            ? <Button size="sm" variant="outline" asChild><a href={`/api/ngos/${r.id}/export?kind=proposal&mode=NGO_FACING&format=pdf`} download><FileText className="size-4" aria-hidden /> Download proposal PDF</a></Button>
                            : <Button size="sm" variant="outline" onClick={() => void audit([r.id])} disabled={runs[r.id]?.status === "RUNNING" || runs[r.id]?.status === "QUEUED"}><FileText className="size-4" aria-hidden /> Run audit for proposal</Button>}
                          <button onClick={() => void patch(r.id, { inCrm: !r.inCrm })} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">{r.inCrm ? "Remove from CRM" : "Add to CRM"}</button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && <tr className="border-t border-dashed border-border bg-muted/30"><td colSpan={10} className="p-0"><DetailsPanel record={r} /></td></tr>}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pitchRecord && <PitchModal record={pitchRecord} onClose={() => setPitchFor(null)} />}
    </div>
  );
}
