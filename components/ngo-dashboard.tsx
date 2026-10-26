"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { EvidenceContext } from "@/components/evidence-card";
import { HaveTab } from "@/components/ngo/have-tab";
import { QuickLinks } from "@/components/ngo/quick-links";
import { ImproveTab } from "@/components/ngo/improve-tab";
import { LackTab } from "@/components/ngo/lack-tab";
import { PitchTab } from "@/components/ngo/pitch-tab";
import { ErrorBox, MetaChip, Notice, PageSkeleton, Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/client/api";
import { CONTACT_LABEL, CONTACT_STATUSES, INTEREST_LABEL, INTEREST_STATUSES, type ContactStatus, type InterestStatus } from "@/lib/crm/types";
import { useNgoData } from "@/components/crm/ngo-data";
import type { NgoPayload } from "@/lib/server/view";
import { formatTime, NOT_ENOUGH } from "@/lib/ui/labels";

export function NgoDashboard({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = React.useState<NgoPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try { setData(await api<NgoPayload>(`/api/ngos/${id}`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load this NGO."); }
  }, [id]);
  React.useEffect(() => {
    let off = false;
    api<NgoPayload>(`/api/ngos/${id}`)
      .then((d) => { if (!off) { setData(d); setError(null); } })
      .catch((e) => { if (!off) setError(e instanceof Error ? e.message : "Could not load this NGO."); });
    return () => { off = true; };
  }, [id]);

  const evidenceMap = React.useMemo(() => new Map((data?.evidence ?? []).map((e) => [e.url, e])), [data?.evidence]);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  const firstSeen = data.job;
  return (
    <EvidenceContext.Provider value={evidenceMap}>
      <div className="space-y-8">
        <Header data={data} onChanged={load} onRefresh={async () => {
          const out = await api<{ jobId: string }>("/api/research/run", { method: "POST", json: { ngoId: data.ngo.id, refresh: true } });
          router.push(`/jobs/${out.jobId}`);
        }} onDeleted={() => router.push("/")} />

        {firstSeen?.status === "PARTIAL" && (
          <Notice tone="warn">This research finished with gaps{firstSeen.error ? ` (${firstSeen.error})` : ""}. Items that could not be checked are marked <strong>Unable to assess</strong>; see the coverage panel for what failed.</Notice>
        )}

        <QuickLinks data={data} />

        <Tabs defaultValue="have" className="w-full">
          <TabsList aria-label="Research sections">
            <TabsTrigger value="have">What They Have</TabsTrigger>
            <TabsTrigger value="lack">What They Lack</TabsTrigger>
            <TabsTrigger value="improve">What We Can Improve</TabsTrigger>
            <TabsTrigger value="pitch">The Pitch</TabsTrigger>
          </TabsList>
          <TabsContent value="have"><HaveTab data={data} /></TabsContent>
          <TabsContent value="lack"><LackTab data={data} onChanged={load} /></TabsContent>
          <TabsContent value="improve"><ImproveTab data={data} onChanged={load} /></TabsContent>
          <TabsContent value="pitch"><PitchTab data={data} onChanged={load} /></TabsContent>
        </Tabs>

        <Coverage data={data} />
      </div>
    </EvidenceContext.Provider>
  );
}

function Header({ data, onChanged, onRefresh, onDeleted }: { data: NgoPayload; onChanged: () => Promise<void>; onRefresh: () => Promise<void>; onDeleted: () => void }) {
  const { ngo, identity, analysis } = data;
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const { patch: patchShared, byId } = useNgoData();
  const live = byId.get(ngo.id) ?? ngo;
  const [follow, setFollow] = React.useState(ngo.followUpAt ? ngo.followUpAt.slice(0, 10) : "");
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  async function patch(json: Parameters<typeof patchShared>[1]) {
    setBusy(true); setErr(null);
    const ok = await patchShared(ngo.id, json);
    if (!ok) setErr("Could not save that change.");
    void onChanged;
    setBusy(false);
  }
  const idLabel = ngo.identityStatus === "CONFIRMED" ? "Identity confirmed by you" : ngo.identityStatus === "AMBIGUOUS" ? "Identity ambiguous" : "Identity matched automatically — please confirm";

  return (
    <header className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">NGO profile</p>
          <h1 className="mt-1 font-serif text-3xl leading-tight sm:text-4xl">{ngo.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[ngo.location, identity?.officialWebsite && (
              <a key="w" className="inline-flex items-center gap-1 underline underline-offset-2" href={identity.officialWebsite} target="_blank" rel="noopener noreferrer">{identity.officialWebsite.replace(/^https?:\/\//, "")}<ExternalLink className="size-3" aria-hidden /></a>
            )].filter(Boolean).map((x, i) => <React.Fragment key={i}>{i > 0 && " · "}{x}</React.Fragment>)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5"><MetaChip>{idLabel}</MetaChip><MetaChip>Researched {formatTime(ngo.lastResearchedAt)}</MetaChip></div>
          {identity && identity.matchSignals.length > 0 && (
            <details className="mt-2 text-sm"><summary className="cursor-pointer text-xs text-muted-foreground">Why we think this is the right organisation</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{identity.matchSignals.map((s, i) => <li key={i}>{s}</li>)}</ul></details>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportMenu id={ngo.id} />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => { setBusy(true); onRefresh().catch((e) => { setErr(e instanceof Error ? e.message : "Could not start."); setBusy(false); }); }}><RefreshCw className="size-4" aria-hidden /> Refresh research</Button>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border bg-card p-4">
          <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Digital readiness</dt>
          <dd className="mt-1 font-serif text-3xl tabular-nums">{analysis?.readiness.overall ?? <span className="text-base font-sans text-muted-foreground">{NOT_ENOUGH}</span>}{analysis?.readiness.overall != null && <span className="text-base text-muted-foreground"> / 100</span>}</dd>
          <dd className="mt-1 text-xs text-muted-foreground">Observable digital readiness only — not the quality of their work.</dd>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Prospect priority <span className="normal-case tracking-normal">(internal)</span></dt>
          <dd className="mt-1 font-serif text-3xl tabular-nums">{analysis?.opportunity?.total ?? "—"}<span className="text-base text-muted-foreground"> / 100</span></dd>
          {analysis?.opportunity && (
            <dd><details className="mt-1 text-xs"><summary className="cursor-pointer text-muted-foreground">How this is scored</summary>
              <ul className="mt-1 space-y-0.5">{analysis.opportunity.breakdown.map((b) => <li key={b.criterion} className="flex justify-between gap-2"><span>{b.criterion}</span><span className="tabular-nums">{b.points}/{b.max}</span></li>)}</ul>
              <p className="mt-1 text-muted-foreground">Never shown to the NGO. Ignores any guess about wealth.</p></details></dd>
          )}
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Outreach</dt>
          <dd className="mt-1 grid grid-cols-2 gap-2">
            <label htmlFor="out-status" className="sr-only">Contact status</label>
            <select id="out-status" value={live.contactStatus} onChange={(e) => void patch({ contactStatus: e.target.value as ContactStatus })} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
              {CONTACT_STATUSES.map((s) => <option key={s} value={s}>{CONTACT_LABEL[s]}</option>)}
            </select>
            <label htmlFor="out-interest" className="sr-only">Interest</label>
            <select id="out-interest" value={live.interestStatus} onChange={(e) => void patch({ interestStatus: e.target.value as InterestStatus })} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
              {INTEREST_STATUSES.map((s) => <option key={s} value={s}>{INTEREST_LABEL[s]}</option>)}
            </select>
          </dd>
          <dd className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant={live.inCrm ? "outline" : "default"} onClick={() => void patch({ inCrm: !live.inCrm })}>{live.inCrm ? "In your CRM — remove" : "Add to Outreach CRM"}</Button>
            <details className="w-full text-xs"><summary className="cursor-pointer text-muted-foreground">Follow-up date</summary>
              <div className="mt-2 flex items-end gap-2">
                <div><label htmlFor="follow" className="mb-1 block">Follow up on</label><Input id="follow" type="date" value={follow} onChange={(e) => setFollow(e.target.value)} /></div>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void patch(follow ? { followUpAt: new Date(`${follow}T09:00:00`).toISOString(), contactStatus: "FOLLOW_UP_SCHEDULED" } : { followUpAt: null })}>Save</Button>
              </div>
              <p className="mt-2 text-muted-foreground">Notes and activity live in the <Link className="underline underline-offset-2" href="/crm">Outreach CRM</Link>.</p>
            </details>
          </dd>
        </div>
      </dl>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <div className="text-xs text-muted-foreground">
        {!confirmDelete ? <button className="underline underline-offset-2" onClick={() => setConfirmDelete(true)}>Delete this research…</button> : (
          <span className="inline-flex flex-wrap items-center gap-2">Delete all research, drafts and notes for this NGO? <Button size="sm" variant="destructive" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/api/ngos/${ngo.id}`, { method: "DELETE" }); onDeleted(); } catch (e) { setErr(e instanceof Error ? e.message : "Could not delete."); setBusy(false); } }}>Delete</Button> <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button></span>
        )}
      </div>
    </header>
  );
}

function ExportMenu({ id }: { id: string }) {
  const items: { label: string; kind: string; mode: string; format: string }[] = [
    { label: "Internal report — PDF", kind: "report", mode: "INTERNAL", format: "pdf" },
    { label: "Internal report — Excel", kind: "report", mode: "INTERNAL", format: "xlsx" },
    { label: "Evidence list — CSV", kind: "evidence", mode: "INTERNAL", format: "csv" },
    { label: "NGO-facing report — PDF", kind: "report", mode: "NGO_FACING", format: "pdf" },
    { label: "NGO-facing proposal — PDF", kind: "proposal", mode: "NGO_FACING", format: "pdf" },
  ];
  return (
    <details className="relative">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-2 rounded-md border border-input px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><Download className="size-4" aria-hidden /> Export</summary>
      <ul className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-border bg-card p-1 shadow-lg">
        {items.map((i) => (
          <li key={i.label}>
            <a className="block rounded px-3 py-2 text-sm hover:bg-muted" href={`/api/ngos/${id}/export?kind=${i.kind}&mode=${i.mode}&format=${i.format}`} download>{i.label}</a>
          </li>
        ))}
        <li className="px-3 py-2 text-xs text-muted-foreground">NGO-facing files leave out internal scores, economics and anything you excluded.</li>
      </ul>
    </details>
  );
}

function Coverage({ data }: { data: NgoPayload }) {
  const cov = data.job?.coverage;
  if (!cov) return null;
  return (
    <section aria-labelledby="cov-h" className="rounded-md border border-border bg-card">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span id="cov-h" className="font-serif text-lg">Research coverage</span>
          <span className="text-xs text-muted-foreground">{cov.pagesReviewed} pages retrieved · {cov.officialSources} official · {cov.thirdPartySources} third-party · checked {formatTime(cov.checkedAt)}</span>
        </summary>
        <div className="space-y-5 border-t border-border p-4 text-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left">
              <caption className="sr-only">What was attempted and what succeeded</caption>
              <thead className="text-xs uppercase tracking-wide text-muted-foreground"><tr><th scope="col" className="py-1 pr-3 font-medium">Source</th><th scope="col" className="px-3 py-1 font-medium">Attempted</th><th scope="col" className="px-3 py-1 font-medium">Succeeded</th><th scope="col" className="px-3 py-1 font-medium">Failed</th></tr></thead>
              <tbody>{cov.categories.map((c) => (
                <tr key={c.category} className="border-t border-border align-top"><th scope="row" className="py-1.5 pr-3 font-medium">{c.category}{c.notes.map((n, i) => <span key={i} className="block text-xs font-normal text-muted-foreground">{n}</span>)}</th><td className="px-3 py-1.5 tabular-nums">{c.attempted}</td><td className="px-3 py-1.5 tabular-nums">{c.succeeded}</td><td className="px-3 py-1.5 tabular-nums">{c.failed}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {cov.failures.length > 0 && (
            <div><h3 className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">What could not be retrieved</h3>
              <ul className="space-y-1 text-xs">{cov.failures.map((f, i) => <li key={i}><span className="break-all">{f.url}</span> — {f.status}{f.reason ? `: ${f.reason}` : ""}</li>)}</ul></div>
          )}
          <div><h3 className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Limits of this research</h3>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{cov.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></div>
          <p className="text-xs text-muted-foreground">All checks follow robots.txt and never sign in or bypass access controls. <Link className="underline underline-offset-2" href="/">New search</Link></p>
        </div>
      </details>
    </section>
  );
}

export { Spinner };
