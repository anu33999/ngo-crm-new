"use client";

import * as React from "react";
import { SourceList } from "@/components/evidence-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfidenceChip, EmptyState, MetaChip, Notice, PriorityChip, SectionTitle } from "@/components/shared";
import { api } from "@/lib/client/api";
import { formatInr } from "@/lib/pricing/policy";
import type { RecommendationView } from "@/lib/research/store";
import type { NgoPayload } from "@/lib/server/view";
import { ELIGIBILITY_LABEL, LEVEL_HELP, LEVEL_LABEL } from "@/lib/ui/labels";
import { cn } from "@/lib/utils";

const GROUPS = ["QUICK_WIN", "CORE_IMPROVEMENT", "LONG_TERM"] as const;

export function ImproveTab({ data, onChanged }: { data: NgoPayload; onChanged: () => Promise<void> }) {
  const [err, setErr] = React.useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try { await fn(); await onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); }
  };
  const recs = data.recommendations;
  const doNot = data.analysis?.doNotPitch ?? [];

  return (
    <div className="space-y-10">
      <PricingPanel data={data} />
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}

      {recs.length === 0 && <EmptyState title="No services are recommended yet">No gap was evidenced strongly enough to match a catalogue service. That is a valid outcome — we do not pad recommendations.</EmptyState>}

      {GROUPS.map((g) => {
        const items = recs.filter((r) => r.level === g);
        if (!items.length) return null;
        return (
          <section key={g} aria-labelledby={`grp-${g}`}>
            <SectionTitle hint={LEVEL_HELP[g]}>{LEVEL_LABEL[g]} <span className="text-base text-muted-foreground">· {items.length}</span></SectionTitle>
            <ul className="grid gap-3 lg:grid-cols-2">
              {items.map((r) => <li key={r.id}><RecCard rec={r} data={data} onToggle={(approval) => run(() => api(`/api/recommendations/${r.id}`, { method: "PATCH", json: { approval } }))} onPrice={(o) => run(() => api(`/api/recommendations/${r.id}`, { method: "PATCH", json: { priceOverride: o } }))} /></li>)}
            </ul>
          </section>
        );
      })}

      <section aria-labelledby="dnp">
        <SectionTitle hint="Services the evidence does not support, or that would be premature. Raising them anyway would weaken trust.">What we should not pitch</SectionTitle>
        {doNot.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is currently on the do-not-pitch list.</p> : (
          <ul className="space-y-2">
            {doNot.map((d) => (
              <li key={d.serviceCode} className="rounded-md border border-border bg-card p-3 text-sm">
                <p className="font-medium"><span className="mr-2 font-mono text-xs text-muted-foreground">{d.serviceCode}</span>{d.serviceName}</p>
                <p className="mt-1 text-muted-foreground">{d.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PricingPanel({ data }: { data: NgoPayload }) {
  const p = data.pricing;
  if (p.status !== "APPROVED") {
    return (
      <Notice tone="warn">
        <p className="font-semibold">Pricing: needs human approval</p>
        <p className="mt-1">{p.headline}</p>
        {p.notes.map((n, i) => <p key={i} className="mt-1 text-xs text-muted-foreground">{n}</p>)}
        <p className="mt-2 text-xs text-muted-foreground">Until a pricing policy is approved and activated, drafts quote no price and do not describe any work as free. You can still set a price per service below; it is recorded against your name.</p>
      </Notice>
    );
  }
  return (
    <section aria-labelledby="pricing-h" className="rounded-md border border-border bg-card p-5">
      <h2 id="pricing-h" className="font-serif text-xl">Commercial model</h2>
      <p className="mt-1 text-xs text-muted-foreground">Policy: {p.policyName}</p>
      <p className="mt-3 text-sm">{p.headline}{p.gstNote ? ` ${p.gstNote}` : ""}</p>
      <dl className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Professional scope at no professional fee</dt>
          <dd className="mt-1 text-sm">{p.subsidizedScope.length ? <ul className="list-disc space-y-0.5 pl-5">{p.subsidizedScope.map((s) => <li key={s.code}>{s.name}</li>)}</ul> : <span className="text-muted-foreground">None of the recommended services fall in this scope.</span>}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Monthly maintenance</dt>
          <dd className="mt-1 text-sm">{p.monthlyMaintenance?.amountInr != null ? <>{formatInr(p.monthlyMaintenance.amountInr)} per month{p.gstNote ? " + GST" : ""}<span className="block text-xs text-muted-foreground">{p.monthlyMaintenance.note}</span></> : <span className="text-muted-foreground">None set.</span>}</dd>
        </div>
        {p.oneTime.length > 0 && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Priced items</dt>
            <dd className="mt-1 text-sm"><ul className="space-y-0.5">{p.oneTime.map((l) => <li key={`${l.code}-${l.label}`}>{l.label}: {l.amountInr != null ? formatInr(l.amountInr) : "—"} <span className="text-xs text-muted-foreground">({l.basis}{l.note ? `; ${l.note}` : ""})</span></li>)}</ul></dd>
          </div>
        )}
        {p.requiresSeparateApproval.length > 0 && (
          <div>
            <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Needs separate approval — not priced</dt>
            <dd className="mt-1 text-sm"><ul className="list-disc space-y-0.5 pl-5">{p.requiresSeparateApproval.map((s) => <li key={s.code}>{s.name}</li>)}</ul></dd>
          </div>
        )}
        <div className="md:col-span-2">
          <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Third-party costs that stay with the NGO</dt>
          <dd className="mt-1 text-sm"><ul className="flex flex-wrap gap-1.5">{p.passThrough.map((t) => <li key={t}><MetaChip>{t}</MetaChip></li>)}</ul></dd>
        </div>
      </dl>
      {p.notes.map((n, i) => <p key={i} className="mt-3 text-xs text-muted-foreground">{n}</p>)}
    </section>
  );
}

function RecCard({ rec, data, onToggle, onPrice }: { rec: RecommendationView; data: NgoPayload; onToggle: (a: "PENDING" | "APPROVED" | "REJECTED") => void; onPrice: (o: { amountInr: number; note?: string } | null) => void }) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState(rec.priceOverride ? String(rec.priceOverride.amountInr) : "");
  const [note, setNote] = React.useState(rec.priceOverride?.note ?? "");
  const [priceErr, setPriceErr] = React.useState<string | null>(null);
  const off = rec.approval === "REJECTED";
  const id = React.useId();
  const line = data.pricing.oneTime.find((l) => l.code === rec.serviceCode);
  const covered = data.pricing.subsidizedScope.some((s) => s.code === rec.serviceCode);

  function savePrice(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount.replace(/[,\s₹]/g, ""));
    if (!amount.trim() || !Number.isInteger(n) || n < 0) { setPriceErr("Enter a whole number of rupees, e.g. 12000."); return; }
    setPriceErr(null); onPrice({ amountInr: n, note: note.trim() || undefined });
  }

  return (
    <article className={cn("rounded-md border border-border bg-card p-4", off && "opacity-60")} aria-labelledby={`${id}-t`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground"><span className="font-mono">{rec.serviceCode}</span> · {rec.practiceArea}</p>
          <h3 id={`${id}-t`} className="text-[15px] font-semibold leading-snug">{rec.serviceName}</h3>
        </div>
        <Button size="sm" variant={off ? "outline" : "default"} aria-pressed={!off} onClick={() => onToggle(off ? "PENDING" : "REJECTED")}>{off ? "Include" : "Included"}</Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <PriorityChip value={rec.priority} /><ConfidenceChip value={rec.confidence} />
        <MetaChip>{rec.effort} effort</MetaChip>
        <MetaChip>{ELIGIBILITY_LABEL[rec.pricingEligibility]}</MetaChip>
        {covered && <MetaChip className="text-foreground">No professional fee under approved policy</MetaChip>}
        {line?.amountInr != null && <MetaChip className="text-foreground">{formatInr(line.amountInr)} {line.basis}</MetaChip>}
      </div>
      <p className="mt-3 text-sm leading-relaxed"><span className="font-medium">Why. </span>{rec.reason}</p>
      <p className="mt-2 text-sm leading-relaxed"><span className="font-medium">What we would do. </span>{rec.proposedDeliverables}</p>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="mt-3 min-h-8 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{open ? "Hide" : "Show"} outcome, inputs, pricing and sources</button>
      {open && (
        <div className="mt-2 space-y-3 border-t border-border pt-3 text-sm">
          <p><span className="font-medium">Expected outcome. </span>{rec.expectedOutcome}</p>
          <p><span className="font-medium">How we would measure it. </span>{rec.successMetric}</p>
          <p><span className="font-medium">What we need from the NGO. </span>{rec.ngoInputs}</p>
          <p><span className="font-medium">Third-party dependencies. </span>{rec.thirdPartyDeps}</p>
          {rec.packageTiers.length > 0 && <p><span className="font-medium">Package tiers that include it. </span>{rec.packageTiers.map((t) => t[0] + t.slice(1).toLowerCase()).join(", ")}</p>}
          {rec.addOnNames.length > 0 && <p><span className="font-medium">Catalogue add-ons. </span>{rec.addOnNames.join("; ")}</p>}
          <SourceList urls={rec.evidenceUrls} />
          <form onSubmit={savePrice} className="rounded-md border border-dashed border-border p-3">
            <p className="text-xs font-medium">Price override (INR) {rec.priceOverride && <span className="font-normal text-muted-foreground">— set by {rec.priceOverride.approvedBy}</span>}</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div><label htmlFor={`${id}-amt`} className="mb-1 block text-xs">Amount</label><Input id={`${id}-amt`} className="w-32" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="e.g. 12000" /></div>
              <div className="min-w-40 flex-1"><label htmlFor={`${id}-note`} className="mb-1 block text-xs">Note</label><Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Why this price" /></div>
              <Button type="submit" size="sm" variant="outline">Save</Button>
              {rec.priceOverride && <Button type="button" size="sm" variant="ghost" onClick={() => { setAmount(""); setNote(""); onPrice(null); }}>Clear</Button>}
            </div>
            {priceErr && <p role="alert" className="mt-1 text-xs text-destructive">{priceErr}</p>}
            <p className="mt-2 text-xs text-muted-foreground">Only whole rupees. The figure is stored with your name and used in the proposal and exports.</p>
          </form>
        </div>
      )}
    </article>
  );
}
