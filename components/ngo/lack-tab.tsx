"use client";

import * as React from "react";
import { FindingCard, ReviewActions } from "@/components/evidence-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, MetaChip, Notice, SectionTitle, StateBadge } from "@/components/shared";
import { api } from "@/lib/client/api";
import { FRAMEWORK_BY_ID } from "@/lib/research/gaps";
import type { FindingView } from "@/lib/research/store";
import type { GapState } from "@/lib/research/types";
import type { NgoPayload } from "@/lib/server/view";
import { STATE_HELP, STATE_LABEL } from "@/lib/ui/labels";
import { cn } from "@/lib/utils";

type Filter = GapState | "ALL" | "NONE";
const ORDER: GapState[] = ["CONFIRMED_ISSUE", "LIKELY_OPPORTUNITY", "NOT_FOUND_PUBLICLY", "UNABLE_TO_ASSESS"];

export function LackTab({ data, onChanged }: { data: NgoPayload; onChanged: () => Promise<void> }) {
  const [filter, setFilter] = React.useState<Filter>("ALL");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const areaFinding = (areaId: string) => data.findings.find((f) => f.key === `area.${areaId}`);
  const areas = data.analysis?.areas ?? [];
  const top = (data.analysis?.top ?? []).map((t) => ({ ...t, finding: areaFinding(t.areaId) })).filter((t): t is typeof t & { finding: FindingView } => !!t.finding);

  async function review(f: FindingView, status: FindingView["reviewStatus"]) {
    setBusy(f.id); setErr(null);
    try { await api(`/api/findings/${f.id}`, { method: "PATCH", json: { reviewStatus: status } }); await onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(null); }
  }
  const actions = (f: FindingView) => <ReviewActions finding={f} busy={busy === f.id} onReview={(s) => review(f, s)} />;

  const counts = (s: GapState) => areas.filter((a) => a.gapState === s).length;
  const none = areas.filter((a) => a.gapState === null).length;
  const visible = areas.filter((a) => filter === "ALL" || (filter === "NONE" ? a.gapState === null : a.gapState === filter));
  const sorted = [...visible].sort((a, b) => (a.gapState ? ORDER.indexOf(a.gapState) : 9) - (b.gapState ? ORDER.indexOf(b.gapState) : 9));

  return (
    <div className="space-y-10">
      <Notice>
        Every finding carries one of four evidence states. <strong>Not found publicly</strong> means we looked in the places listed and did not see it — it may exist elsewhere. <strong>Unable to assess</strong> means the evidence was not accessible; it is not a finding.
      </Notice>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}

      <section aria-labelledby="top5">
        <SectionTitle hint="Ranked by likely impact, urgency, how sure we are, and how achievable the fix is. Weaker evidence ranks lower.">The 5 biggest opportunities</SectionTitle>
        {top.length === 0 ? (
          <EmptyState title="No evidenced opportunity to rank">Either no gap was evidenced strongly enough, or the website could not be assessed. Look at “Unable to assess” below.</EmptyState>
        ) : (
          <ol className="grid gap-3 lg:grid-cols-2" id="top5">
            {top.map((t, i) => (
              <li key={t.areaId}>
                <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{FRAMEWORK_BY_ID[t.areaId].title}</p>
                <FindingCard finding={t.finding} rank={i + 1} actions={actions(t.finding)} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="all22">
        <SectionTitle hint="All 22 areas of the maturity framework, each with its evidence state. Areas with no gap evidenced are listed too — silence is not a failure.">Every area we looked at</SectionTitle>
        <div role="group" aria-label="Filter by evidence state" className="mb-4 flex flex-wrap gap-2">
          {([["ALL", `All ${areas.length}`], ...ORDER.map((s) => [s, `${STATE_LABEL[s]} · ${counts(s)}`]), ["NONE", `No gap evidenced · ${none}`]] as [Filter, string][]).map(([k, label]) => (
            <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} aria-pressed={filter === k} onClick={() => setFilter(k)} title={k !== "ALL" && k !== "NONE" ? STATE_HELP[k] : undefined}>{label}</Button>
          ))}
        </div>
        {sorted.length === 0 ? <EmptyState title="Nothing in this group" /> : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {sorted.map((a) => {
              const f = areaFinding(a.areaId);
              const area = FRAMEWORK_BY_ID[a.areaId];
              if (f) return <li key={a.areaId}><p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{area.title}</p><FindingCard finding={f} actions={actions(f)} /></li>;
              return (
                <li key={a.areaId} className={cn("rounded-md border border-border bg-card p-4")}>
                  <h3 className="text-[15px] font-semibold">{area.title}</h3>
                  <div className="mt-2 flex flex-wrap gap-1.5"><MetaChip>No gap evidenced</MetaChip><MetaChip>{a.assessment === "STRONG" ? "Looks strong" : a.assessment === "ADEQUATE" ? "Looks adequate" : "Baseline checks passed"}</MetaChip></div>
                  <p className="mt-2 text-sm text-muted-foreground">The checks we could run on public information did not show a gap here.</p>
                </li>
              );
            })}
          </ul>
        )}
        {filter === "ALL" && <p className="mt-3 text-xs text-muted-foreground">{(["CONFIRMED_ISSUE", "LIKELY_OPPORTUNITY", "NOT_FOUND_PUBLICLY", "UNABLE_TO_ASSESS"] as GapState[]).map((s) => <span key={s} className="mr-3 inline-flex items-center gap-1"><StateBadge state={s} className="px-1.5 py-0" /></span>)}</p>}
      </section>

      <AddSource ngoId={data.ngo.id} onChanged={onChanged} />
    </div>
  );
}

function AddSource({ ngoId, onChanged }: { ngoId: string; onChanged: () => Promise<void> }) {
  const [url, setUrl] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await api(`/api/ngos/${ngoId}/evidence`, { method: "POST", json: { url, summary } });
      setUrl(""); setSummary(""); setMsg({ ok: true, text: "Source added to the evidence list." }); await onChanged();
    } catch (er) { setMsg({ ok: false, text: er instanceof Error ? er.message : "Could not add the source." }); }
    finally { setBusy(false); }
  }
  return (
    <section aria-labelledby="add-src" className="rounded-md border border-dashed border-border p-4">
      <h2 id="add-src" className="font-serif text-lg">Found something we missed?</h2>
      <p className="mt-1 text-sm text-muted-foreground">Add a page that shows the NGO already has something we reported as not found. It is kept with the evidence, labelled as added by your team.</p>
      <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <div><label htmlFor="src-url" className="mb-1 block text-xs font-medium">Page address</label><Input id="src-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" required /></div>
        <div><label htmlFor="src-sum" className="mb-1 block text-xs font-medium">What it shows</label><Input id="src-sum" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} placeholder="e.g. Has a CSR partnerships page" /></div>
        <div className="flex items-end"><Button type="submit" variant="outline" disabled={busy || url.trim().length < 8}>{busy ? "Adding…" : "Add source"}</Button></div>
      </form>
      {msg && <p role={msg.ok ? "status" : "alert"} className={cn("mt-2 text-sm", !msg.ok && "text-destructive")}>{msg.text}</p>}
    </section>
  );
}
