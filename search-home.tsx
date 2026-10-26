"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorBox, MetaChip, Notice, Skeleton, Spinner } from "@/components/shared";
import { api } from "@/lib/client/api";
import type { JobRecord } from "@/lib/research/store";
import { CONTACT_LABEL, type NgoRecord } from "@/lib/crm/types";
import { formatTime } from "@/lib/ui/labels";

interface Status { search: string[]; searchConfigured: boolean; searchMode?: "full" | "reduced" | "off"; ai: boolean; pagespeed: boolean; store: string }

export function SearchHome() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<Status | null>(null);
  const [recent, setRecent] = React.useState<{ jobs: JobRecord[]; ngos: NgoRecord[] } | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api<Status>("/api/status"), api<{ jobs: JobRecord[]; ngos: NgoRecord[] }>("/api/research")]);
      setStatus(s); setRecent(r); setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load recent searches.");
    }
  }, []);
  React.useEffect(() => {
    let off = false;
    Promise.all([api<Status>("/api/status"), api<{ jobs: JobRecord[]; ngos: NgoRecord[] }>("/api/research")])
      .then(([s, r]) => { if (!off) { setStatus(s); setRecent(r); setLoadError(null); } })
      .catch((e) => { if (!off) setLoadError(e instanceof Error ? e.message : "Could not load recent searches."); });
    return () => { off = true; };
  }, []);

  async function submit(e: React.FormEvent, refresh = false) {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) { setError("Enter the NGO's name (at least 2 characters)."); return; }
    setBusy(true);
    try {
      const out = await api<{ jobId: string; ngoId: string | null; cached: boolean }>("/api/research", { method: "POST", json: { name, location, refresh } });
      router.push(out.cached && out.ngoId ? `/ngo/${out.ngoId}` : `/jobs/${out.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the search.");
      setBusy(false);
    }
  }

  const active = recent?.jobs.filter((j) => ["QUEUED", "RUNNING", "AWAITING_DISAMBIGUATION"].includes(j.status)) ?? [];

  return (
    <div className="space-y-10">
      <section aria-labelledby="search-h">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">NGO research</p>
        <h1 id="search-h" className="mt-1 font-serif text-3xl leading-tight sm:text-4xl">Who would you like to learn about?</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Enter an NGO&apos;s name. We look at what is publicly visible, say how sure we are about each finding, and draft outreach for you to review. Nothing is sent automatically.
        </p>

        <form onSubmit={submit} className="mt-6 grid gap-3 sm:grid-cols-[1fr_14rem_auto]" noValidate>
          <div>
            <label htmlFor="ngo-name" className="mb-1 block text-xs font-medium">NGO name</label>
            <Input id="ngo-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Asha Kiran Foundation" autoComplete="off" maxLength={200} aria-describedby={error ? "search-error" : undefined} />
          </div>
          <div>
            <label htmlFor="ngo-loc" className="mb-1 block text-xs font-medium">City or state <span className="font-normal text-muted-foreground">(optional)</span></label>
            <Input id="ngo-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Hyderabad" autoComplete="off" maxLength={120} />
          </div>
          <div className="flex items-end">
            <Button type="submit" size="lg" disabled={busy} className="w-full sm:w-auto">
              {busy ? <Spinner label="Starting…" /> : <><Search className="size-4" aria-hidden /> Research</>}
            </Button>
          </div>
        </form>
        {error && <p id="search-error" role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        <p className="mt-2 text-xs text-muted-foreground">A location helps tell apart organisations that share a name.</p>
      </section>

      {status && !status.searchConfigured && (
        <Notice tone="warn">
          <strong>Search is turned off</strong> (KEYLESS_SEARCH=off and no key), so research by name cannot run. NGOs with a website on record can still be audited from Discovery.
        </Notice>
      )}
      {status?.searchMode === "reduced" && (
        <Notice tone="warn">
          <strong>Reduced research mode.</strong> No search API key is set, so audits use a keyless DuckDuckGo fallback: fewer results and slower, and every audit that used it is labelled “reduced research”. For full depth add a <code className="rounded bg-muted px-1">TINYFISH_API_KEY</code> (or <code className="rounded bg-muted px-1">TAVILY_API_KEY</code>) to <code className="rounded bg-muted px-1">.env</code> and restart.
        </Notice>
      )}
      {status && status.searchConfigured && !status.ai && (
        <Notice>No <code className="rounded bg-muted px-1">ANTHROPIC_API_KEY</code> is set. Research works fully; outreach drafts are composed directly from the evidence instead of being polished by a language model.</Notice>
      )}
      {status?.store === "memory" && <Notice tone="warn">Running with the in-memory store: results disappear when the server restarts.</Notice>}

      {loadError && <ErrorBox message={loadError} onRetry={load} />}

      {active.length > 0 && (
        <section aria-labelledby="active-h">
          <h2 id="active-h" className="mb-3 font-serif text-xl">In progress</h2>
          <ul className="space-y-2">
            {active.map((j) => (
              <li key={j.id}>
                <Link href={`/jobs/${j.id}`} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3 text-sm hover:bg-muted/60">
                  <span className="min-w-0"><span className="font-medium">{j.queryName}</span>{j.queryLocation ? `, ${j.queryLocation}` : ""}</span>
                  <MetaChip>{j.status === "AWAITING_DISAMBIGUATION" ? "Needs your choice" : `${j.progress}%`}</MetaChip>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="recent-h">
        <h2 id="recent-h" className="mb-3 font-serif text-xl">Recent research</h2>
        {!recent && !loadError && <div className="space-y-2" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>}
        {recent && recent.ngos.length === 0 && <EmptyState title="No NGOs researched yet">Your completed research will appear here, with its readiness and opportunity scores and outreach status.</EmptyState>}
        {recent && recent.ngos.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {recent.ngos.map((n) => (
              <li key={n.id}>
                <Link href={`/ngo/${n.id}`} className="group flex h-full flex-col gap-2 rounded-md border border-border bg-card p-4 hover:bg-muted/60">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{n.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{[n.location, n.website?.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ") || "No website identified"}</p>
                    </div>
                    <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <MetaChip>Readiness {n.readinessScore ?? "—"}{n.readinessScore === null ? " (not enough evidence)" : ""}</MetaChip>
                    <MetaChip>Opportunity {n.opportunityScore ?? "—"}</MetaChip>
                    <MetaChip>{CONTACT_LABEL[n.contactStatus]}</MetaChip>
                  </div>
                  {n.lastResearchedAt && <p className="text-xs text-muted-foreground">Researched {formatTime(n.lastResearchedAt)}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {recent && recent.jobs.some((j) => j.status === "FAILED" || j.status === "CANCELLED") && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Failed or cancelled runs</summary>
            <ul className="mt-2 space-y-1">
              {recent.jobs.filter((j) => j.status === "FAILED" || j.status === "CANCELLED").map((j) => (
                <li key={j.id}><Link className="underline underline-offset-2" href={`/jobs/${j.id}`}>{j.queryName}{j.queryLocation ? `, ${j.queryLocation}` : ""}</Link> — {j.status === "FAILED" ? "failed" : "cancelled"} {formatTime(j.finishedAt)}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
