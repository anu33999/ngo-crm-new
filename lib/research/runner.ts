import type { Candidate } from "./identity";
import { runPipeline, type PipelineDeps } from "./pipeline";
import type { JobRecord } from "./store";
import { normalizeName } from "./text";
import { registrableDomain } from "@/lib/search/normalize";

/**
 * Job orchestration: start, cancel, retry, resolve ambiguity. The pipeline itself is in pipeline.ts.
 *
 * Background work: `launch` hands the running promise to `keepAlive` (the API layer passes Next's `after()`
 * so the platform keeps the invocation alive). Cancellation works two ways — an in-process AbortController
 * and a CANCELLED status in the store that the pipeline checks between steps — so it also works when the
 * cancel request lands on a different server instance.
 */

const running = new Map<string, AbortController>();
/** Jobs created for a batch that are waiting for a free slot — they are alive, not stale. */
const waiting = new Set<string>();
const STALE_MS = 10 * 60 * 1000;

export type KeepAlive = (p: Promise<unknown>) => void;
export const noKeepAlive: KeepAlive = () => undefined;

export function launch(jobId: string, deps: PipelineDeps, keepAlive: KeepAlive = noKeepAlive): Promise<JobRecord> {
  const ctrl = new AbortController();
  running.set(jobId, ctrl);
  const p = runPipeline(jobId, deps, ctrl.signal).finally(() => running.delete(jobId));
  p.catch(() => undefined);
  keepAlive(p);
  return p;
}

export function isRunningHere(jobId: string) { return running.has(jobId); }

export class InputError extends Error {}

export function cleanQuery(name: unknown, location: unknown) {
  const strip = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  const n = strip(name);
  const l = strip(location);
  if (n.length < 2) throw new InputError("Enter the NGO's name (at least 2 characters).");
  if (n.length > 200) throw new InputError("The NGO name is too long (200 characters maximum).");
  if (l.length > 120) throw new InputError("The location is too long (120 characters maximum).");
  return { name: n, location: l || undefined };
}

function manualCandidate(name: string, website: string): Candidate {
  const u = new URL(website);
  const domain = registrableDomain(u.hostname) ?? u.hostname;
  return { key: `manual:${domain}`, name, domain, website: `${u.protocol}//${u.hostname}`, locationHints: [], evidenceUrls: [], score: 1, signals: ["Official website supplied by a person"], directoryOnly: false };
}

/**
 * Resolve what to audit: an existing record (directory / CRM) by id, an existing record with the same name and place,
 * or a brand-new name. A person-entered website on an un-audited record skips identity guessing.
 */
async function resolveTarget(deps: PipelineDeps, input: { name?: unknown; location?: unknown; ngoId?: string }) {
  const { store } = deps;
  if (input.ngoId) {
    const rec = await store.getRecord(input.ngoId);
    if (!rec) throw new InputError("NGO not found.");
    const known = rec.website && (!rec.audited || rec.identityStatus === "CONFIRMED") ? rec.website : null;
    let candidate: Candidate | undefined;
    if (known) { try { candidate = manualCandidate(rec.name, known); } catch { /* ignore an unusable stored website */ } }
    return { name: rec.name, location: rec.city ?? rec.location ?? undefined, ngoId: rec.id, candidate, rec };
  }
  const { name, location } = cleanQuery(input.name, input.location);
  const n = normalizeName(name);
  const same = (await store.listRecords({ search: name })).find((r) => normalizeName(r.name) === n && (!location || (r.city ?? "").toLowerCase() === location.toLowerCase()));
  return { name, location, ngoId: same?.id, candidate: undefined as Candidate | undefined, rec: same ?? null };
}

export async function startResearch(deps: PipelineDeps, input: { name?: unknown; location?: unknown; ngoId?: string; refresh?: boolean }, keepAlive: KeepAlive = noKeepAlive) {
  const t = await resolveTarget(deps, input);
  if (!input.refresh) {
    if (t.rec?.audited && t.rec.latestJobId) return { jobId: t.rec.latestJobId, ngoId: t.rec.id, cached: true };
    const cached = await deps.store.findCachedJob(t.name, t.location, 24 * 3600 * 1000);
    if (cached) return { jobId: cached.id, ngoId: cached.ngoId, cached: true };
  }
  const job = await deps.store.createJob({ queryName: t.name, queryLocation: t.location, ngoId: t.ngoId, isRefresh: !!input.refresh });
  if (t.candidate) await deps.store.updateJob(job.id, { candidates: { options: [t.candidate], selectedKey: t.candidate.key } });
  void launch(job.id, deps, keepAlive);
  return { jobId: job.id, ngoId: t.ngoId ?? null, cached: false };
}

/** Audit several directory / CRM records, a few at a time. Already-audited records are skipped unless `refresh`. */
export async function startBatch(deps: PipelineDeps, ids: string[], opts: { refresh?: boolean; concurrency?: number } = {}, keepAlive: KeepAlive = noKeepAlive) {
  const unique = [...new Set(ids)].slice(0, 25);
  const started: { ngoId: string; jobId: string }[] = [];
  const skipped: { ngoId: string; reason: string; jobId?: string }[] = [];
  const queue: string[] = [];
  for (const id of unique) {
    const t = await resolveTarget(deps, { ngoId: id }).catch(() => null);
    if (!t) { skipped.push({ ngoId: id, reason: "NGO not found." }); continue; }
    if (!opts.refresh && t.rec?.audited && t.rec.latestJobId) { skipped.push({ ngoId: id, reason: "Already audited — open the saved audit or refresh it.", jobId: t.rec.latestJobId }); continue; }
    const job = await deps.store.createJob({ queryName: t.name, queryLocation: t.location, ngoId: t.ngoId, isRefresh: !!opts.refresh });
    if (t.candidate) await deps.store.updateJob(job.id, { candidates: { options: [t.candidate], selectedKey: t.candidate.key } });
    waiting.add(job.id);
    queue.push(job.id);
    started.push({ ngoId: id, jobId: job.id });
  }
  const width = Math.max(1, Math.min(opts.concurrency ?? 2, 4));
  const worker = async () => {
    for (let jobId = queue.shift(); jobId; jobId = queue.shift()) {
      waiting.delete(jobId);
      const cur = await deps.store.getJob(jobId);
      if (cur?.status === "CANCELLED") continue;
      await launch(jobId, deps).catch(() => undefined);
    }
  };
  if (queue.length) keepAlive(Promise.all(Array.from({ length: Math.min(width, queue.length) }, worker)));
  return { started, skipped };
}

const ACTIVE = new Set(["QUEUED", "RUNNING", "AWAITING_DISAMBIGUATION"]);

export async function cancelJob(deps: PipelineDeps, jobId: string): Promise<JobRecord> {
  const job = await deps.store.getJob(jobId);
  if (!job) throw new InputError("Job not found.");
  if (!ACTIVE.has(job.status)) return job;
  const updated = await deps.store.updateJob(jobId, { status: "CANCELLED", finishedAt: new Date().toISOString() });
  running.get(jobId)?.abort();
  return updated;
}

export async function retryJob(deps: PipelineDeps, jobId: string, keepAlive: KeepAlive = noKeepAlive) {
  const old = await deps.store.getJob(jobId);
  if (!old) throw new InputError("Job not found.");
  if (ACTIVE.has(old.status) && !(await isStale(deps, old))) throw new InputError("This job is still active. Cancel it first if you want to retry.");
  const job = await deps.store.createJob({ queryName: old.queryName, queryLocation: old.queryLocation ?? undefined, ngoId: old.ngoId ?? undefined, parentJobId: old.id, attempt: old.attempt + 1, isRefresh: true, selectedKey: old.candidates.selectedKey });
  // keep a person's earlier choice so a retry does not ask again
  if (old.candidates.selectedKey && old.candidates.options.length) await deps.store.updateJob(job.id, { candidates: { options: old.candidates.options, selectedKey: old.candidates.selectedKey } });
  void launch(job.id, deps, keepAlive);
  return { jobId: job.id };
}

export async function selectCandidate(deps: PipelineDeps, jobId: string, choice: { key?: string; website?: string }, keepAlive: KeepAlive = noKeepAlive) {
  const job = await deps.store.getJob(jobId);
  if (!job) throw new InputError("Job not found.");
  if (job.status !== "AWAITING_DISAMBIGUATION") throw new InputError("This job is not waiting for a choice.");
  const options = [...job.candidates.options];
  let key = choice.key;
  if (choice.website) {
    let u: URL;
    try { u = new URL(/^https?:\/\//i.test(choice.website) ? choice.website : `https://${choice.website}`); } catch { throw new InputError("That website address is not valid."); }
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw new InputError("That website address is not valid.");
    const cand = manualCandidate(job.queryName, `${u.protocol}//${u.hostname}`);
    options.push(cand);
    key = cand.key;
  }
  if (!key || !options.some((c) => c.key === key)) throw new InputError("Choose one of the listed organisations, or enter the official website.");
  await deps.store.updateJob(jobId, { candidates: { options, selectedKey: key }, status: "QUEUED", error: null });
  void launch(jobId, deps, keepAlive);
  return { jobId };
}

async function isStale(deps: PipelineDeps, job: JobRecord) {
  void deps;
  if (running.has(job.id) || waiting.has(job.id) || job.status === "AWAITING_DISAMBIGUATION") return false;
  const ref = Date.parse(job.startedAt ?? job.createdAt);
  return Date.now() - ref > STALE_MS;
}

/** Mark jobs that claim to be running but whose process is gone (crash, redeploy) as failed. */
export async function reapIfStale(deps: PipelineDeps, job: JobRecord): Promise<JobRecord> {
  if ((job.status === "RUNNING" || job.status === "QUEUED") && (await isStale(deps, job))) {
    return deps.store.updateJob(job.id, { status: "FAILED", error: "The job stopped unexpectedly (the server may have restarted). Retry to run it again.", finishedAt: new Date().toISOString() });
  }
  return job;
}

export { normalizeName };
