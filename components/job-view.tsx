"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Circle, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBox, MetaChip, PageSkeleton, Spinner } from "@/components/shared";
import { api } from "@/lib/client/api";
import { STAGES, type JobRecord } from "@/lib/research/store";
import { cn } from "@/lib/utils";

const ACTIVE = ["QUEUED", "RUNNING"];

export function JobView({ id }: { id: string }) {
  const router = useRouter();
  const [job, setJob] = React.useState<JobRecord | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [website, setWebsite] = React.useState("");
  const [actionError, setActionError] = React.useState<string | null>(null);
  const failures = React.useRef(0);
  const [nonce, setNonce] = React.useState(0);

  const poll = React.useCallback(async () => {
    try {
      const j = await api<JobRecord>(`/api/research/${id}`);
      failures.current = 0; setError(null); setJob(j);
      return j;
    } catch (e) {
      failures.current++;
      if (failures.current >= 3) setError(e instanceof Error ? e.message : "Lost contact with the server.");
      return null;
    }
  }, [id]);

  React.useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const j = await poll();
      if (stop) return;
      if (j && (j.status === "COMPLETED" || j.status === "PARTIAL") && j.ngoId) { router.replace(`/ngo/${j.ngoId}`); return; }
      if (!j || ACTIVE.includes(j.status)) timer = setTimeout(tick, 1500);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [poll, router, nonce]);

  async function act(path: string, body?: unknown) {
    setBusy(true); setActionError(null);
    try {
      const out = await api<{ jobId?: string }>(`/api/research/${id}/${path}`, { method: "POST", json: body ?? {} });
      if (path === "retry" && out.jobId) router.push(`/jobs/${out.jobId}`);
      else setNonce((n) => n + 1); // restart polling after cancel / select
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "That did not work.");
    } finally { setBusy(false); }
  }

  if (error) return <ErrorBox message={error} onRetry={() => { failures.current = 0; setError(null); void poll(); }} />;
  if (!job) return <PageSkeleton />;

  const stageIndex = job.stage ? STAGES.findIndex((s) => s.id === job.stage) : -1;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Research in progress</p>
        <h1 className="mt-1 font-serif text-3xl leading-tight">{job.queryName}{job.queryLocation ? <span className="text-muted-foreground">, {job.queryLocation}</span> : null}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <MetaChip>{labelFor(job.status)}</MetaChip>
          {job.attempt > 1 && <MetaChip>Attempt {job.attempt}</MetaChip>}
        </div>
      </header>

      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress} aria-label="Research progress" className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(job.progress, 3)}%` }} />
      </div>

      <ol className="space-y-1">
        {STAGES.map((s, i) => {
          const entry = [...job.stageLog].reverse().find((l) => l.stage === s.id);
          const done = entry?.status === "done";
          const failed = entry?.status === "failed";
          const current = ACTIVE.includes(job.status) && i === stageIndex && !done;
          return (
            <li key={s.id} className={cn("flex items-start gap-3 rounded-md px-3 py-2 text-sm", current && "bg-muted")}>
              <span className="mt-0.5" aria-hidden>
                {done ? <Check className="size-4" /> : failed ? <X className="size-4 text-destructive" /> : current ? <LoaderCircle className="size-4 animate-spin" /> : <Circle className="size-4 text-muted-foreground/60" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn(!done && !current && !failed && "text-muted-foreground")}>{s.label}</span>
                {failed && entry?.note && <span className="mt-0.5 block text-xs text-muted-foreground">Problem: {entry.note}</span>}
              </span>
              <span className="sr-only">{done ? "done" : failed ? "failed" : current ? "in progress" : "waiting"}</span>
            </li>
          );
        })}
      </ol>

      {ACTIVE.includes(job.status) && (
        <div className="flex flex-wrap items-center gap-3">
          <Spinner label="Working. You can leave this page; the job continues." />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => act("cancel")}>Cancel</Button>
        </div>
      )}

      {job.status === "AWAITING_DISAMBIGUATION" && (
        <section aria-labelledby="pick-h" className="space-y-4">
          <div>
            <h2 id="pick-h" className="font-serif text-xl">Which organisation do you mean?</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">The search matched more than one organisation, or none clearly. Nothing has been audited yet. Choose the right one so we do not report on the wrong NGO.</p>
          </div>
          <ul className="space-y-2">
            {job.candidates.options.map((c) => (
              <li key={c.key} className="rounded-md border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{c.name}</p>
                    {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-muted-foreground underline underline-offset-2">{c.website}</a>}
                  </div>
                  <Button size="sm" disabled={busy} onClick={() => act("select", { key: c.key })}>Use this one</Button>
                </div>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{c.signals.map((s, i) => <li key={i}>{s}</li>)}</ul>
                <p className="mt-2 text-xs text-muted-foreground">Match strength {(c.score * 100).toFixed(0)}%{c.directoryOnly ? " · listed in a directory only, no official site found" : ""}</p>
              </li>
            ))}
          </ul>
          <form className="rounded-md border border-dashed border-border p-4" onSubmit={(e) => { e.preventDefault(); void act("select", { website }); }}>
            <label htmlFor="site" className="text-sm font-medium">None of these? Enter the official website</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Input id="site" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.example.org" inputMode="url" />
              <Button type="submit" variant="outline" disabled={busy || website.trim().length < 4}>Use this website</Button>
            </div>
          </form>
        </section>
      )}

      {(job.status === "FAILED" || job.status === "CANCELLED") && (
        <div className="space-y-3">
          {job.status === "FAILED" && <ErrorBox message={job.error ?? "The research failed."} />}
          {job.status === "CANCELLED" && <p className="text-sm text-muted-foreground">This run was cancelled. Nothing was saved.</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => act("retry")}>Retry</Button>
            <Button variant="outline" asChild><Link href="/">Back to search</Link></Button>
          </div>
        </div>
      )}
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
    </div>
  );
}

function labelFor(s: JobRecord["status"]) {
  return { QUEUED: "Queued", RUNNING: "Running", AWAITING_DISAMBIGUATION: "Waiting for your choice", COMPLETED: "Completed", PARTIAL: "Completed with gaps", FAILED: "Failed", CANCELLED: "Cancelled" }[s];
}
