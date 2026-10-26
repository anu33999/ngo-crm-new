"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorBox, Skeleton } from "@/components/shared";
import { facetsOf, matchesFilter, type NgoRecord } from "@/lib/crm/types";
import { formatTime } from "@/lib/ui/labels";
import { useNgoData } from "./ngo-data";
import { CategoryPills, CityTag, ContactBadge, ContactSelect, InterestSelect, MeetingCell, NotesCell, RunChip, ScorePills, WebsiteStatusPill } from "./parts";
import { PageHeader, selectCls, StatStrip } from "./page-header";

type Sort = "recent" | "opportunity" | "name";

export function HistoryView() {
  const { records, loaded, error, refresh, runs, audit, patch } = useNgoData();
  const [search, setSearch] = React.useState("");
  const [city, setCity] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [category, setCategory] = React.useState("all");
  const [sort, setSort] = React.useState<Sort>("recent");

  const audited = React.useMemo(() => records.filter((r) => r.audited), [records]);
  const cities = React.useMemo(() => [...new Set(audited.map((r) => r.city).filter((c): c is string => !!c))].sort(), [audited]);
  const rows = React.useMemo(() => {
    const list = audited.filter((r) => matchesFilter(r, { search, city, category, status: status === "all" ? undefined : (status as NgoRecord["contactStatus"]) }));
    return list.sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name)
      : sort === "opportunity" ? (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1)
      : (b.lastResearchedAt ?? "").localeCompare(a.lastResearchedAt ?? ""));
  }, [audited, search, city, category, status, sort]);
  const categories = React.useMemo(() => facetsOf(audited).categories, [audited]);

  return (
    <div>
      <PageHeader eyebrow="Search history" title="Every NGO you have audited" actions={<Button asChild variant="accent"><Link href="/"><Plus className="size-4" aria-hidden /> New search</Link></Button>}>
        Open a saved audit instantly — nothing is re-scraped — or refresh it to run fresh research in the background.
      </PageHeader>

      <StatStrip items={[
        { label: "Audited NGOs", value: audited.length, tone: "gold" },
        { label: "Contacted", value: audited.filter((r) => r.contactStatus === "CONTACTED").length, tone: "ok", onClick: () => setStatus("CONTACTED"), active: status === "CONTACTED" },
        { label: "Follow-up scheduled", value: audited.filter((r) => r.contactStatus === "FOLLOW_UP_SCHEDULED").length, tone: "info", onClick: () => setStatus("FOLLOW_UP_SCHEDULED"), active: status === "FOLLOW_UP_SCHEDULED" },
        { label: "Not contacted", value: audited.filter((r) => r.contactStatus === "NOT_CONTACTED").length, tone: "warn", onClick: () => setStatus("NOT_CONTACTED"), active: status === "NOT_CONTACTED" },
        { label: "Interested", value: audited.filter((r) => r.interestStatus === "INTERESTED").length, tone: "ok" },
        { label: "Uninterested", value: audited.filter((r) => r.interestStatus === "UNINTERESTED").length, tone: "bad" },
      ]} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_11rem_12rem_11rem_12rem]">
        <div className="relative">
          <label htmlFor="h-search" className="sr-only">Search audited NGOs by name or cause</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="h-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, category or notes…" className="pl-9" autoComplete="off" />
        </div>
        <div><label htmlFor="h-city" className="sr-only">Filter by location</label>
          <select id="h-city" value={city} onChange={(e) => setCity(e.target.value)} className={`${selectCls} w-full`}>
            <option value="all">All locations</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div><label htmlFor="h-cat" className="sr-only">Filter by category</label>
          <select id="h-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={`${selectCls} w-full`}>
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
          </select></div>
        <div><label htmlFor="h-status" className="sr-only">Filter by outreach</label>
          <select id="h-status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${selectCls} w-full`}>
            <option value="all">Contacted or not</option>
            <option value="NOT_CONTACTED">Not contacted</option>
            <option value="CONTACTED">Contacted</option>
            <option value="FOLLOW_UP_SCHEDULED">Follow-up scheduled</option>
          </select></div>
        <div><label htmlFor="h-sort" className="sr-only">Sort</label>
          <select id="h-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={`${selectCls} w-full`}>
            <option value="recent">Most recently audited</option>
            <option value="opportunity">Highest opportunity</option>
            <option value="name">Name A–Z</option>
          </select></div>
      </div>

      {error && <ErrorBox message={error} onRetry={refresh} />}
      {!loaded && !error && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true"><Skeleton className="h-44" /><Skeleton className="h-44" /><Skeleton className="h-44" /></div>}
      {loaded && audited.length === 0 && <EmptyState title="Nothing audited yet">Search for an NGO, or run a Deep Audit from the Discovery tab. Every audit you run is saved here.</EmptyState>}
      {loaded && audited.length > 0 && rows.length === 0 && <EmptyState title="No audited NGO matches those filters">Clear the search or choose another location.</EmptyState>}

      <p className="sr-only" aria-live="polite">{rows.length} audited NGOs shown</p>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <li key={r.id} className="surface card-lift relative flex flex-col gap-3 overflow-hidden p-4 pt-5"><span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: r.contactStatus === "CONTACTED" ? "var(--ok)" : r.contactStatus === "FOLLOW_UP_SCHEDULED" ? "var(--info)" : "var(--warn)" }} />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate font-serif text-lg leading-snug" title={r.name}>{r.name}</h2>
                <div className="mt-1"><CityTag record={r} /></div>
              </div>
              <ContactBadge status={r.contactStatus} />
            </div>
            <p className="text-xs text-muted-foreground">Audited {formatTime(r.lastResearchedAt)}</p>
            <div className="flex flex-wrap items-center gap-1.5"><WebsiteStatusPill record={r} /><ScorePills record={r} /></div>
            <CategoryPills record={r} />
            <div className="rounded-md border border-dashed border-border p-1.5">
              <p className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
              <NotesCell record={r} wide />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Contacted?</span><ContactSelect record={r} /></div>
              <div><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Interest</span><InterestSelect record={r} /></div>
            </div>
            <div><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Meeting</span><MeetingCell record={r} stacked={false} /></div>
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
              <Button asChild size="sm"><Link href={`/ngo/${r.id}`}>Reopen audit <ArrowRight className="size-4" aria-hidden /></Link></Button>
              <Button size="sm" variant="outline" onClick={() => void audit([r.id], { refresh: true })} disabled={runs[r.id]?.status === "RUNNING" || runs[r.id]?.status === "QUEUED"}>
                <RefreshCw className="size-4" aria-hidden /> Refresh intelligence
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void patch(r.id, { inCrm: !r.inCrm })} aria-pressed={r.inCrm}>{r.inCrm ? "In CRM ✓" : "Add to CRM"}</Button>
              <RunChip run={runs[r.id]} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
