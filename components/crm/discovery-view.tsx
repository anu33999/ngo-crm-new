"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, ClipboardCheck, Compass, FileSpreadsheet, Plus, Search, Sparkles, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorBox, Skeleton, Spinner } from "@/components/shared";
import { api } from "@/lib/client/api";
import { facetsOf, matchesFilter, TWIN_CITIES, type NgoFilter, type NgoRecord, type Priority } from "@/lib/crm/types";
import { useNgoData } from "./ngo-data";
import { CategoryCell, CityTag, ContactCheckbox, DarpanBadge, InterestSelect, MeetingCell, NotesCell, PhoneCell, PriorityPill, RunChip, SourceChip, WebsiteCell } from "./parts";
import { DetailsPanel } from "./details-panel";
import { ImportPanel } from "./import-panel";
import { PageHeader, selectCls, StatStrip } from "./page-header";

const PAGE = 100;
const PRIO: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
const isTwin = (r: NgoRecord) => !!r.city && (TWIN_CITIES as readonly string[]).includes(r.city);

export function DiscoveryView() {
  const router = useRouter();
  const { records, loaded, error, refresh, bulk, audit, runs, patch, toast } = useNgoData();
  const twin = React.useMemo(() => records.filter(isTwin), [records]);
  const facets = React.useMemo(() => facetsOf(twin), [twin]);

  const [city, setCity] = React.useState("all");
  const [area, setArea] = React.useState("all");
  const [cause, setCause] = React.useState("all");
  const [darpan, setDarpan] = React.useState<"all" | "verified" | "unverified">("all");
  const [contact, setContact] = React.useState("all");
  const [priority, setPriority] = React.useState("all");
  const [interest, setInterest] = React.useState("all");
  const [meeting, setMeeting] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const [showImport, setShowImport] = React.useState(false);
  const [paging, setPaging] = React.useState<{ sig: string; n: number }>({ sig: "", n: PAGE });
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = React.useState(false);
  const [showFind, setShowFind] = React.useState(false);

  const filter: NgoFilter = React.useMemo(() => ({
    city, area, category: cause, search, darpan: darpan === "all" ? undefined : darpan,
    status: contact === "all" ? undefined : (contact as NgoRecord["contactStatus"]),
    priority: priority === "all" ? undefined : (priority as Priority),
    interest: interest === "all" ? undefined : (interest as NgoRecord["interestStatus"]),
    meeting: meeting ? true : undefined,
  }), [city, area, cause, search, darpan, contact, priority, interest, meeting]);
  const rows = React.useMemo(() => twin.filter((r) => matchesFilter(r, filter)).sort((a, b) => (PRIO[a.priority ?? ""] ?? 3) - (PRIO[b.priority ?? ""] ?? 3) || (a.city ?? "").localeCompare(b.city ?? "") || (a.area ?? "~").localeCompare(b.area ?? "~") || a.name.localeCompare(b.name)), [twin, filter]);
  const sig = JSON.stringify(filter);
  const limit = paging.sig === sig ? paging.n : PAGE;
  const shown = rows.slice(0, limit);

  // keep the selection limited to rows that are still visible and still exist
  const visibleIds = React.useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const chosen = React.useMemo(() => [...selected].filter((id) => visibleIds.has(id)), [selected, visibleIds]);
  const allSelected = rows.length > 0 && chosen.length === rows.length;
  const someSelected = chosen.length > 0 && !allSelected;
  const headRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (headRef.current) headRef.current.indeterminate = someSelected; }, [someSelected]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  async function runAudit(ids: string[]) {
    const todo = ids.filter((id) => !twin.find((r) => r.id === id)?.audited);
    const done = ids.length - todo.length;
    if (todo.length) await audit(todo);
    else if (ids.length === 1) { router.push(`/ngo/${ids[0]}`); return; }
    if (done && todo.length) toast(`${done} already audited — open them from the row action.`, "info");
  }

  const hasFilters = city !== "all" || area !== "all" || cause !== "all" || darpan !== "all" || contact !== "all" || priority !== "all" || interest !== "all" || meeting || search !== "";
  const clear = () => { setCity("all"); setArea("all"); setCause("all"); setDarpan("all"); setContact("all"); setPriority("all"); setInterest("all"); setMeeting(false); setSearch(""); };
  const toggleOpen = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div>
      <PageHeader eyebrow="Twin-Cities Discovery" title="Hyderabad & Secunderabad NGO directory"
        actions={<>
          <Button variant="outline" onClick={() => { setShowImport((v) => !v); setShowFind(false); setShowAdd(false); }}><FileSpreadsheet className="size-4" aria-hidden /> Import spreadsheet</Button>
          <Button variant="outline" onClick={() => { setShowFind((v) => !v); setShowAdd(false); setShowImport(false); }}><Sparkles className="size-4" aria-hidden /> Discover more</Button>
          <Button variant="outline" onClick={() => { setShowAdd((v) => !v); setShowFind(false); setShowImport(false); }}><UserPlus className="size-4" aria-hidden /> Add an NGO</Button>
        </>}>
        Your Hyderabad & Secunderabad list: tick the ones you contact, edit phone, website and notes right in the row, and everything syncs to the CRM and the map. Import more from a spreadsheet any time.
      </PageHeader>

      <StatStrip items={[
        { label: "NGOs in your list", value: twin.length, tone: "gold" },
        { label: "Contacted", value: twin.filter((r) => r.contactStatus !== "NOT_CONTACTED").length, tone: "ok", onClick: () => setContact("CONTACTED"), active: contact === "CONTACTED" },
        { label: "Not contacted yet", value: twin.filter((r) => r.contactStatus === "NOT_CONTACTED").length, tone: "warn", onClick: () => setContact("NOT_CONTACTED"), active: contact === "NOT_CONTACTED" },
        { label: "High priority", value: twin.filter((r) => r.priority === "High").length, tone: "bad", onClick: () => setPriority("High"), active: priority === "High" },
        { label: "Interested", value: twin.filter((r) => r.interestStatus === "INTERESTED" || r.interestStatus === "CONTRACT_SIGNED").length, tone: "ok", onClick: () => setInterest((v) => (v === "INTERESTED" ? "all" : "INTERESTED")), active: interest === "INTERESTED" },
        { label: "Meetings scheduled", value: twin.filter((r) => r.meetingScheduled).length, tone: "info", onClick: () => setMeeting((m) => !m), active: meeting },
      ]} />
      <details className="surface mb-1 px-4 py-2.5 text-sm">
        <summary className="cursor-pointer text-muted-foreground"><span className="font-medium text-foreground">About this list</span> — where the data comes from and how sure it is</summary>
        <p className="mt-2 text-muted-foreground">It combines your spreadsheet (contact details exactly as listed there — public-source data to verify before outreach; a “check” flag marks numbers that look incomplete) with entries read from public NGO Darpan listings on 21 Oct 2026. Anything blank was not found, not confirmed to be absent. Map positions are neighbourhood- or city-level approximations, not street addresses.</p>
      </details>

      {showImport && <ImportPanel onClose={() => setShowImport(false)} />}
      {showAdd && <AddNgoForm onDone={() => setShowAdd(false)} />}
      {showFind && <DiscoverMore onAdded={() => undefined} />}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_8.5rem_9rem_11rem_8.5rem_9.5rem_9.5rem_9rem]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <label htmlFor="d-search" className="sr-only">Search the directory</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="d-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, category, area, contact, notes…" className="pl-9" autoComplete="off" />
        </div>
        <Select id="d-city" label="City" value={city} onChange={setCity} all="All cities" options={facets.cities} />
        <Select id="d-area" label="Area" value={area} onChange={setArea} all="All areas" options={facets.areas} />
        <div><label htmlFor="d-cause" className="sr-only">Category</label>
          <select id="d-cause" value={cause} onChange={(e) => setCause(e.target.value)} className={`${selectCls} w-full`}>
            <option value="all">All categories</option>
            {facets.categories.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
          </select></div>
        <div><label htmlFor="d-priority" className="sr-only">Priority</label>
          <select id="d-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={`${selectCls} w-full`}>
            <option value="all">Any priority</option>{["High", "Medium", "Low"].map((p) => <option key={p} value={p}>{p} priority</option>)}
          </select></div>
        <div><label htmlFor="d-darpan" className="sr-only">Darpan verification</label>
          <select id="d-darpan" value={darpan} onChange={(e) => setDarpan(e.target.value as typeof darpan)} className={`${selectCls} w-full`}>
            <option value="all">Any Darpan status</option><option value="verified">Listed on Darpan</option><option value="unverified">Not confirmed on Darpan</option>
          </select></div>
        <div><label htmlFor="d-contact" className="sr-only">Contacted</label>
          <select id="d-contact" value={contact} onChange={(e) => setContact(e.target.value)} className={`${selectCls} w-full`}>
            <option value="all">Contacted or not</option><option value="NOT_CONTACTED">Not contacted</option><option value="CONTACTED">Contacted</option><option value="FOLLOW_UP_SCHEDULED">Follow-up scheduled</option>
          </select></div>
        <div><label htmlFor="d-interest" className="sr-only">Interest</label>
          <select id="d-interest" value={interest} onChange={(e) => setInterest(e.target.value)} className={`${selectCls} w-full`}>
            <option value="all">Any interest</option><option value="PENDING">Pending</option><option value="INTERESTED">Interested</option><option value="UNINTERESTED">Uninterested</option><option value="CONTRACT_SIGNED">Contract signed</option>
          </select></div>
      </div>

      <div className="sticky top-[3.6rem] z-30 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/90 p-2.5 shadow-[var(--shadow-soft)] backdrop-blur" role="toolbar" aria-label="Actions for selected NGOs">
        <span className="px-1 text-sm tabular-nums" aria-live="polite">{chosen.length ? `${chosen.length} selected` : `${rows.length} match · ${twin.length} in list`}</span>
        <Button size="sm" disabled={!chosen.length} onClick={() => void bulk(chosen, { inCrm: true }, `Added ${chosen.length} to the Outreach CRM.`)}><Plus className="size-4" aria-hidden /> Add selected to Outreach CRM</Button>
        <Button size="sm" variant="outline" disabled={!chosen.length} onClick={() => void bulk(chosen, { contactStatus: "CONTACTED" }, `Marked ${chosen.length} as contacted.`)}><ClipboardCheck className="size-4" aria-hidden /> Mark selected as contacted</Button>
        <Button size="sm" variant="outline" disabled={!chosen.length} onClick={() => void runAudit(chosen)}><Compass className="size-4" aria-hidden /> Run deep audit on selected</Button>
        {hasFilters && <Button size="sm" variant="ghost" onClick={clear}>Clear filters</Button>}
        {chosen.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>}
      </div>

      {error && <div className="mt-4"><ErrorBox message={error} onRetry={refresh} /></div>}
      {!loaded && !error && <div className="mt-4 space-y-2" aria-busy="true"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
      {loaded && twin.length === 0 && <div className="mt-4"><EmptyState title="No Hyderabad or Secunderabad NGOs yet">Import a spreadsheet, reload the starter list from Export &amp; Settings, or add an NGO by hand.</EmptyState></div>}
      {loaded && twin.length > 0 && rows.length === 0 && <div className="mt-4"><EmptyState title="Nothing matches those filters"><button className="underline underline-offset-2" onClick={clear}>Clear the filters</button></EmptyState></div>}

      {rows.length > 0 && (
        <div className="mt-4 table-shell">
          <table className="w-full min-w-[92rem] text-left text-sm">
            <caption className="sr-only">Hyderabad and Secunderabad NGOs with contact tracking</caption>
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 p-3"><input ref={headRef} type="checkbox" className="size-4" checked={allSelected} onChange={toggleAll} aria-label="Select all shown NGOs" /></th>
                <th scope="col" className="p-3 font-medium">NGO</th>
                <th scope="col" className="p-3 font-medium">Category</th>
                <th scope="col" className="p-3 font-medium">Location</th>
                <th scope="col" className="p-3 font-medium">Contact</th>
                <th scope="col" className="p-3 font-medium">Status</th>
                <th scope="col" className="p-3 font-medium">Meeting</th>
                <th scope="col" className="min-w-[13rem] p-3 font-medium">Notes</th>
                <th scope="col" className="p-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const isOpen = open.has(r.id);
                return (
                  <React.Fragment key={r.id}>
                    <tr className={`border-t border-border align-top ${selected.has(r.id) ? "bg-accent/15" : ""}`}>
                      <td className="p-3"><input type="checkbox" className="size-4" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /></td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium">{r.audited ? <Link href={`/ngo/${r.id}`} className="underline-offset-2 hover:underline">{r.name}</Link> : r.name}</span>
                          {r.darpanStatus === "VERIFIED" && <DarpanBadge record={r} />}
                          <PriorityPill priority={r.priority} />
                          {r.inCrm && <span className="pill pill-info">In CRM</span>}
                        </div>
                        {(r.contactPerson || r.email) && (
                          <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
                            {r.contactPerson}{r.designation ? `, ${r.designation}` : ""}{r.contactPerson && r.email ? " · " : ""}
                            {r.email && <a href={`mailto:${r.email.split(" / ")[0]}`} className="underline underline-offset-2">{r.email}</a>}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <SourceChip record={r} />
                          <button onClick={() => toggleOpen(r.id)} aria-expanded={isOpen} aria-controls={`det-${r.id}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {isOpen ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />} Details &amp; notes{r.notes ? " ●" : ""}
                          </button>
                        </div>
                      </td>
                      <td className="p-3"><CategoryCell record={r} /></td>
                      <td className="p-3"><CityTag record={r} />{r.address && <p className="mt-1 max-w-[16rem] text-xs text-muted-foreground">{r.address}</p>}</td>
                      <td className="p-3"><div className="flex flex-col gap-1.5"><PhoneCell record={r} /><WebsiteCell record={r} /></div></td>
                      <td className="p-3">
                        <div className="flex flex-col gap-1.5">
                          <span><ContactCheckbox record={r} />{r.contactedAt && <span className="ml-1 text-[11px] text-muted-foreground">{r.contactedAt.slice(0, 10)}</span>}</span>
                          <InterestSelect record={r} />
                        </div>
                      </td>
                      <td className="p-3"><MeetingCell record={r} /></td>
                      <td className="p-3"><NotesCell record={r} /></td>
                      <td className="p-3">
                        <div className="flex flex-col items-start gap-1.5">
                          {r.audited
                            ? <Button size="sm" variant="outline" asChild><Link href={`/ngo/${r.id}`}>Open audit &amp; pitch</Link></Button>
                            : <Button size="sm" variant="accent" onClick={() => void runAudit([r.id])} disabled={runs[r.id]?.status === "RUNNING" || runs[r.id]?.status === "QUEUED"}>Deep audit &amp; generate pitch</Button>}
                          <RunChip run={runs[r.id]} />
                          <button className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => void patch(r.id, { inCrm: !r.inCrm })}>{r.inCrm ? "Remove from CRM" : "Add to CRM"}</button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && <tr id={`det-${r.id}`} className="border-t border-dashed border-border bg-muted/30"><td colSpan={9} className="p-0"><DetailsPanel record={r} /></td></tr>}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown.length && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <span className="text-muted-foreground" aria-live="polite">Showing {shown.length} of {rows.length}</span>
          <Button variant="outline" size="sm" onClick={() => setPaging({ sig, n: limit + PAGE })}>Show {Math.min(PAGE, rows.length - shown.length)} more</Button>
          <Button variant="ghost" size="sm" onClick={() => setPaging({ sig, n: rows.length })}>Show all</Button>
        </div>
      )}
    </div>
  );
}

function Select({ id, label, value, onChange, all, options }: { id: string; label: string; value: string; onChange: (v: string) => void; all: string; options: string[] }) {
  return (
    <div><label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`${selectCls} w-full`}>
        <option value="all">{all}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select></div>
  );
}

function AddNgoForm({ onDone, defaults }: { onDone: () => void; defaults?: Partial<{ name: string; website: string; city: string }> }) {
  const { addEntry, facets } = useNgoData();
  const [f, setF] = React.useState({ name: defaults?.name ?? "", city: defaults?.city ?? "Hyderabad", area: "", cause: "", phone: "", website: defaults?.website ?? "", address: "" });
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const rec = await addEntry({ ...f, source: defaults ? "DISCOVERED" : "MANUAL" });
    setBusy(false);
    if (rec) onDone();
  }
  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 surface p-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Add an NGO">
      <div className="sm:col-span-2"><label htmlFor="a-name" className="mb-1 block text-xs font-medium">NGO name</label><Input id="a-name" required minLength={2} maxLength={200} value={f.name} onChange={set("name")} /></div>
      <div><label htmlFor="a-city" className="mb-1 block text-xs font-medium">City</label>
        <Input id="a-city" required list="a-cities" value={f.city} onChange={set("city")} maxLength={80} />
        <datalist id="a-cities">{[...new Set([...TWIN_CITIES, ...facets.cities])].map((c) => <option key={c} value={c} />)}</datalist></div>
      <div><label htmlFor="a-area" className="mb-1 block text-xs font-medium">Area <span className="font-normal text-muted-foreground">(optional)</span></label>
        <Input id="a-area" list="a-areas" value={f.area} onChange={set("area")} maxLength={80} placeholder="e.g. Banjara Hills" />
        <datalist id="a-areas">{facets.areas.map((c) => <option key={c} value={c} />)}</datalist></div>
      <div><label htmlFor="a-cause" className="mb-1 block text-xs font-medium">Cause <span className="font-normal text-muted-foreground">(optional)</span></label><Input id="a-cause" value={f.cause} onChange={set("cause")} maxLength={160} /></div>
      <div><label htmlFor="a-phone" className="mb-1 block text-xs font-medium">Phone <span className="font-normal text-muted-foreground">(optional)</span></label><Input id="a-phone" type="tel" value={f.phone} onChange={set("phone")} maxLength={40} /></div>
      <div className="sm:col-span-2"><label htmlFor="a-web" className="mb-1 block text-xs font-medium">Website <span className="font-normal text-muted-foreground">(optional — speeds up the audit)</span></label><Input id="a-web" value={f.website} onChange={set("website")} maxLength={300} placeholder="example.org" /></div>
      <div className="sm:col-span-2 lg:col-span-3"><label htmlFor="a-addr" className="mb-1 block text-xs font-medium">Address <span className="font-normal text-muted-foreground">(optional)</span></label><Input id="a-addr" value={f.address} onChange={set("address")} maxLength={300} /></div>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><Button type="submit" disabled={busy}>{busy ? <Spinner label="Adding…" /> : "Add to directory"}</Button><Button type="button" variant="ghost" onClick={onDone}>Cancel</Button></div>
    </form>
  );
}

interface Found { title: string; snippet: string; url: string; kind: string }

function DiscoverMore({ onAdded }: { onAdded: () => void }) {
  const { facets } = useNgoData();
  const [city, setCity] = React.useState("Hyderabad");
  const [area, setArea] = React.useState("");
  const [cause, setCause] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [out, setOut] = React.useState<{ results: Found[]; note: string } | null>(null);
  const [adding, setAdding] = React.useState<Found | null>(null);

  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null); setOut(null);
    try { setOut(await api("/api/directory/discover", { method: "POST", json: { city, area, cause } })); }
    catch (x) { setErr(x instanceof Error ? x.message : "Search failed."); }
    finally { setBusy(false); }
  }
  const origin = (u: string) => { try { return new URL(u).origin; } catch { return ""; } };
  return (
    <section className="mt-4 surface p-4" aria-labelledby="dm-h">
      <h2 id="dm-h" className="font-serif text-lg">Discover more by search</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">Runs a web search for NGOs in an area. Results are web pages, not a registry — add only the ones you recognise, then run a Deep Audit to confirm.</p>
      <form onSubmit={go} className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr_1fr_auto]">
        <div><label htmlFor="dm-city" className="sr-only">City</label><select id="dm-city" value={city} onChange={(e) => setCity(e.target.value)} className={`${selectCls} w-full`}>{TWIN_CITIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label htmlFor="dm-area" className="sr-only">Area</label><Input id="dm-area" list="dm-areas" placeholder="Area, e.g. Secunderabad Cantonment" value={area} onChange={(e) => setArea(e.target.value)} maxLength={80} /><datalist id="dm-areas">{facets.areas.map((a) => <option key={a} value={a} />)}</datalist></div>
        <div><label htmlFor="dm-cause" className="sr-only">Cause</label><Input id="dm-cause" placeholder="Cause, e.g. education (optional)" value={cause} onChange={(e) => setCause(e.target.value)} maxLength={80} /></div>
        <Button type="submit" disabled={busy}>{busy ? <Spinner label="Searching…" /> : "Search"}</Button>
      </form>
      {err && <p role="alert" className="mt-3 text-sm text-destructive">{err}</p>}
      {out && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-muted-foreground">{out.note}</p>
          {out.results.length === 0 && <p className="text-sm">No results came back for that search.</p>}
          <ul className="space-y-2">
            {out.results.map((r) => (
              <li key={r.url} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-2 hover:underline">{r.title || r.url}</a><p className="break-all text-xs text-muted-foreground">{r.url}</p></div>
                  <Button size="sm" variant="outline" onClick={() => setAdding(r)}>Add as NGO…</Button>
                </div>
                {r.snippet && <p className="mt-1 text-xs text-muted-foreground">{r.snippet}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {adding && <AddNgoForm key={adding.url} defaults={{ name: adding.title.split(/[|–—-]/)[0].trim().slice(0, 120), website: ["DIRECTORY", "NEWS", "SOCIAL", "GOVERNMENT_REGISTRY"].includes(adding.kind) ? "" : origin(adding.url), city }} onDone={() => { setAdding(null); onAdded(); }} />}
    </section>
  );
}
