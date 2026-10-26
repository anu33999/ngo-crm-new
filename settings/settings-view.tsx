"use client";

import * as React from "react";
import { Check, Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBox, Notice, Spinner } from "@/components/shared";
import { useNgoData } from "@/components/crm/ngo-data";
import { PageHeader } from "@/components/crm/page-header";
import { api } from "@/lib/client/api";
import type { PolicyConfig, PricingModelKind } from "@/lib/pricing/policy";
import { STANDARD_PASS_THROUGH } from "@/lib/pricing/policy";

interface Status { search: string[]; searchConfigured: boolean; searchMode?: "full" | "reduced" | "off"; ai: boolean; pagespeed: boolean; store: string; accessGate: boolean }
interface PricingData {
  policies: PolicyConfig[]; active: PolicyConfig | null;
  tiers: { tier: "SILVER" | "GOLD" | "PLATINUM"; name: string; monthlyPriceInr: number }[];
  services: { code: string; name: string; practiceArea: string; eligibility: string }[];
}

export function SettingsView() {
  const { records, refresh, toast } = useNgoData();
  const [status, setStatus] = React.useState<Status | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { let off = false; api<Status>("/api/status").then((s) => { if (!off) setStatus(s); }).catch(() => undefined); return () => { off = true; }; }, []);
  const crmCount = records.filter((r) => r.inCrm).length;

  async function reload() {
    setBusy(true);
    try {
      const out = await api<{ created: number; existing: number }>("/api/directory/seed", { method: "POST", json: {} });
      toast(out.created ? `Added ${out.created} starter NGOs (${out.existing} were already there).` : "The starter directory is already complete.", "info");
      await refresh();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not reload.", "error"); }
    finally { setBusy(false); }
  }

  const links: { label: string; href: string }[] = [
    { label: "CSV", href: "/api/export?format=csv" }, { label: "Excel", href: "/api/export?format=xlsx" }, { label: "PDF", href: "/api/export?format=pdf" },
  ];

  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Export & settings" title="Reports, pricing policy and system status" />

      <section aria-labelledby="ex-h">
        <h2 id="ex-h" className="mb-1 font-serif text-xl">Export your CRM</h2>
        <p className="mb-3 max-w-prose text-sm text-muted-foreground">Internal working files for the Kreatif Atelier team. They include readiness and opportunity scores, so do not send them to NGOs. NGO-facing reports and proposals are exported per NGO from its audit page.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border bg-card p-4">
            <h3 className="text-sm font-medium">My NGOs <span className="text-muted-foreground">({crmCount})</span></h3>
            <div className="mt-3 flex flex-wrap gap-2">{links.map((l) => <Button key={l.label} asChild variant="outline" size="sm"><a href={l.href}><Download className="size-4" aria-hidden /> {l.label}</a></Button>)}</div>
          </div>
          <div className="rounded-md border border-border bg-card p-4">
            <h3 className="text-sm font-medium">Whole directory <span className="text-muted-foreground">({records.length})</span></h3>
            <div className="mt-3 flex flex-wrap gap-2">{links.map((l) => <Button key={l.label} asChild variant="outline" size="sm"><a href={`${l.href}&scope=all`}><Download className="size-4" aria-hidden /> {l.label}</a></Button>)}</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Text that starts with = + - or @ is prefixed with an apostrophe so spreadsheets never run it as a formula. The PDF uses a standard font, so names in non-Latin scripts may not print; use CSV or Excel for those.</p>
      </section>

      <PricingPolicySection />

      <section aria-labelledby="sys-h">
        <h2 id="sys-h" className="mb-3 font-serif text-xl">System status</h2>
        {!status ? <Spinner /> : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat ok={status.searchMode === "full"} label="Web search" detail={status.searchMode === "full" ? `Full depth — ${status.search.join(", ")}` : status.searchMode === "reduced" ? "Reduced — keyless DuckDuckGo only; add TINYFISH_API_KEY for full depth" : "Off — set TINYFISH_API_KEY"} />
            <Stat ok={status.ai} label="Pitch polishing (Claude)" detail={status.ai ? "On" : "Off — drafts are composed from evidence"} neutral />
            <Stat ok={status.pagespeed} label="PageSpeed Insights" detail={status.pagespeed ? "On" : "Off — performance is not measured"} neutral />
            <Stat ok={status.store === "database"} label="Storage" detail={status.store === "database" ? "Database" : "In-memory (not saved)"} />
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={reload} disabled={busy}>{busy ? <Spinner label="Reloading…" /> : "Reload the starter directory"}</Button>
          <span className="text-xs text-muted-foreground">Adds any missing NGO from the bundled list (28 from NGO Darpan listings + 248 from your Asraya spreadsheet). NGOs already present keep everything you changed; only their empty fields are filled.</span>
        </div>
      </section>
    </div>
  );
}

function Stat({ ok, label, detail, neutral }: { ok: boolean; label: string; detail: string; neutral?: boolean }) {
  return (
    <li className="rounded-md border border-border bg-card p-3 text-sm">
      <span className={`pill ${ok ? "pill-ok" : neutral ? "pill-muted" : "pill-warn"}`}>{ok ? "Ready" : neutral ? "Optional" : "Attention"}</span>
      <p className="mt-2 font-medium">{label}</p><p className="text-xs text-muted-foreground">{detail}</p>
    </li>
  );
}

const MODEL_HELP: Record<PricingModelKind, string> = {
  STANDARD_PACKAGES: "Quote the Silver / Gold / Platinum list prices from the NGO package workbook.",
  SUBSIDIZED_MAINTENANCE: "No professional fee for the services you choose below; the NGO pays a monthly maintenance charge. Third-party costs stay with the NGO.",
  CUSTOM: "Everything is priced by hand per NGO. Nothing is quoted automatically.",
};

type Draft = { id?: string; name: string; model: PricingModelKind; gstExtra: boolean; subsidizedServiceCodes: string[]; maintenance: PolicyConfig["maintenance"]; rules: string };
const blankDraft = (): Draft => ({ name: "", model: "STANDARD_PACKAGES", gstExtra: true, subsidizedServiceCodes: [], maintenance: { mode: "NONE" }, rules: "" });

function PricingPolicySection() {
  const { toast } = useNgoData();
  const [data, setData] = React.useState<PricingData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [d, setD] = React.useState<Draft | null>(null);
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try { setData(await api<PricingData>("/api/settings/pricing")); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Could not load pricing settings."); }
  }, []);
  React.useEffect(() => { let off = false; api<PricingData>("/api/settings/pricing").then((x) => { if (!off) setData(x); }).catch((e) => { if (!off) setError(e instanceof Error ? e.message : "Could not load pricing settings."); }); return () => { off = true; }; }, []);

  const edit = (p: PolicyConfig) => setD({ id: p.id, name: p.name, model: p.model, gstExtra: p.gstExtra, subsidizedServiceCodes: p.subsidizedServiceCodes, maintenance: p.maintenance, rules: (p.thirdPartyCostRules ?? []).join("\n") });

  async function save() {
    if (!d) return;
    setBusy(true);
    try {
      const out = await api<{ policy: PolicyConfig }>("/api/settings/pricing", { method: "POST", json: { ...d, thirdPartyCostRules: d.rules.split("\n").map((x) => x.trim()).filter(Boolean) } });
      toast("Saved as a draft. It does not take effect until you approve it.", "info");
      await load(); edit(out.policy);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save the policy.", "error"); }
    finally { setBusy(false); }
  }
  async function setState(id: string, state: "APPROVE" | "RETIRE") {
    setBusy(true);
    try { await api("/api/settings/pricing", { method: "PATCH", json: { id, state } }); toast(state === "APPROVE" ? "Policy approved and now active." : "Policy retired.", "info"); await load(); setD(null); }
    catch (e) { toast(e instanceof Error ? e.message : "That did not work.", "error"); }
    finally { setBusy(false); }
  }

  const services = React.useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.services ?? []).filter((s) => !t || s.name.toLowerCase().includes(t) || s.code.toLowerCase().includes(t) || s.practiceArea.toLowerCase().includes(t));
  }, [data, q]);

  return (
    <section aria-labelledby="pp-h">
      <h2 id="pp-h" className="mb-1 font-serif text-xl">Pricing policy</h2>
      <p className="mb-3 max-w-prose text-sm text-muted-foreground">Until a policy is approved, proposals and pitches quote no prices and say &ldquo;needs human approval&rdquo;. Saving a policy only creates a draft; approving it records your name and makes it the single active policy. Editing an approved policy sends it back to draft.</p>
      {error && <ErrorBox message={error} onRetry={load} />}
      {!data && !error && <Spinner />}
      {data && (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-2">
            {data.active ? <Notice>Active: <strong>{data.active.name}</strong>{data.active.approvedBy ? ` · approved by ${data.active.approvedBy}` : ""}</Notice> : <Notice tone="warn">No policy is active. Pitches show no prices.</Notice>}
            <ul className="space-y-1.5">
              {data.policies.map((p) => (
                <li key={p.id}><button onClick={() => edit(p)} className={`flex w-full items-center justify-between gap-2 rounded-md border p-2.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${d?.id === p.id ? "border-accent bg-accent/20" : "border-border bg-card"}`}>
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className={`pill ${p.isActive ? "pill-ok" : p.status === "RETIRED" ? "pill-muted" : "pill-warn"}`}>{p.isActive ? "Active" : p.status === "RETIRED" ? "Retired" : "Draft"}</span>
                </button></li>
              ))}
            </ul>
            <Button variant="outline" size="sm" onClick={() => setD(blankDraft())}><Plus className="size-4" aria-hidden /> New policy</Button>
          </div>

          {d ? (
            <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4 rounded-md border border-border bg-card p-4">
              <div><label htmlFor="p-name" className="mb-1 block text-xs font-medium">Policy name</label><Input id="p-name" required minLength={2} maxLength={80} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></div>
              <fieldset><legend className="mb-1 text-xs font-medium">Pricing model</legend>
                <div className="space-y-2">{(Object.keys(MODEL_HELP) as PricingModelKind[]).map((m) => (
                  <label key={m} className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/15">
                    <input type="radio" name="model" className="mt-1" checked={d.model === m} onChange={() => setD({ ...d, model: m })} />
                    <span><span className="font-medium">{m === "STANDARD_PACKAGES" ? "Standard packages" : m === "SUBSIDIZED_MAINTENANCE" ? "Subsidised scope + maintenance" : "Custom, per NGO"}</span><span className="block text-xs text-muted-foreground">{MODEL_HELP[m]}</span></span>
                  </label>))}</div></fieldset>

              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.gstExtra} onChange={(e) => setD({ ...d, gstExtra: e.target.checked })} /> Prices are exclusive of GST (GST extra)</label>

              <fieldset><legend className="mb-1 text-xs font-medium">Maintenance charge</legend>
                <div className="flex flex-wrap items-center gap-2">
                  <select aria-label="Maintenance mode" value={d.maintenance.mode} onChange={(e) => { const m = e.target.value; setD({ ...d, maintenance: m === "NONE" ? { mode: "NONE" } : m === "BASELINE_TIER" ? { mode: "BASELINE_TIER", tier: "SILVER" } : { mode: "CUSTOM", monthlyInr: 0 } }); }} className="h-10 rounded-md border border-input bg-card px-3 text-sm">
                    <option value="NONE">No maintenance charge</option><option value="BASELINE_TIER">Use a package tier price as reference</option><option value="CUSTOM">Custom monthly amount</option>
                  </select>
                  {d.maintenance.mode === "BASELINE_TIER" && (
                    <select aria-label="Package tier" value={d.maintenance.tier} onChange={(e) => setD({ ...d, maintenance: { mode: "BASELINE_TIER", tier: e.target.value as "SILVER" | "GOLD" | "PLATINUM" } })} className="h-10 rounded-md border border-input bg-card px-3 text-sm">
                      {data.tiers.map((t) => <option key={t.tier} value={t.tier}>{t.name} — ₹{t.monthlyPriceInr.toLocaleString("en-IN")}/month</option>)}
                    </select>)}
                  {d.maintenance.mode === "CUSTOM" && (<><label htmlFor="p-mi" className="text-sm">₹ per month</label><Input id="p-mi" type="number" min={0} step={1} className="w-36" value={d.maintenance.monthlyInr} onChange={(e) => setD({ ...d, maintenance: { mode: "CUSTOM", monthlyInr: Math.max(0, Math.floor(Number(e.target.value) || 0)) } })} /></>)}
                </div></fieldset>

              {d.model === "SUBSIDIZED_MAINTENANCE" && (
                <fieldset><legend className="mb-1 text-xs font-medium">Services provided at no professional fee <span className="font-normal text-muted-foreground">({d.subsidizedServiceCodes.length} chosen)</span></legend>
                  <Input aria-label="Filter services" placeholder="Filter by name, code or practice area…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
                  <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-border p-1.5 text-sm">
                    {services.map((s) => (
                      <li key={s.code}><label className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-muted">
                        <input type="checkbox" className="mt-1" checked={d.subsidizedServiceCodes.includes(s.code)} onChange={(e) => setD({ ...d, subsidizedServiceCodes: e.target.checked ? [...d.subsidizedServiceCodes, s.code] : d.subsidizedServiceCodes.filter((c) => c !== s.code) })} />
                        <span><span className="font-mono text-xs text-muted-foreground">{s.code}</span> {s.name}<span className="block text-xs text-muted-foreground">{s.practiceArea}</span></span>
                      </label></li>))}
                    {services.length === 0 && <li className="p-2 text-xs text-muted-foreground">No service matches that filter.</li>}
                  </ul></fieldset>)}

              <div><label htmlFor="p-rules" className="mb-1 block text-xs font-medium">Costs that stay with the NGO <span className="font-normal text-muted-foreground">(one per line; blank uses the standard list)</span></label>
                <textarea id="p-rules" rows={4} value={d.rules} onChange={(e) => setD({ ...d, rules: e.target.value })} placeholder={STANDARD_PASS_THROUGH.join("\n")} className="w-full rounded-md border border-input bg-card p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>Save draft</Button>
                {d.id && data.policies.find((p) => p.id === d.id)?.status === "DRAFT" && <Button type="button" variant="accent" disabled={busy} onClick={() => void setState(d.id as string, "APPROVE")}><Check className="size-4" aria-hidden /> Approve &amp; activate</Button>}
                {d.id && data.policies.find((p) => p.id === d.id)?.status === "APPROVED" && <Button type="button" variant="outline" disabled={busy} onClick={() => void setState(d.id as string, "RETIRE")}>Retire</Button>}
                <Button type="button" variant="ghost" onClick={() => setD(null)}>Close</Button>
              </div>
              <p className="text-xs text-muted-foreground">Approval is recorded under your sign-in name (or “local” if no access password is set).</p>
            </form>
          ) : <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Choose a policy, or create a new one.</div>}
        </div>
      )}
    </section>
  );
}
