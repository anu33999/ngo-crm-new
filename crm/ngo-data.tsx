"use client";

import * as React from "react";
import { applyPatchLocal, facetsOf, type NgoPatch, type NgoRecord } from "@/lib/crm/types";
import { api } from "@/lib/client/api";
import type { JobRecord, JobStatus, StageId } from "@/lib/research/store";

/**
 * One shared, optimistic copy of every NGO record for the whole app. The CRM table, the Map popup, the
 * Discovery table and History cards all read and write through this provider, so flipping a status in one
 * place changes it everywhere at once; the server write follows, and on failure everything reloads from the server.
 */

export interface AuditRun { jobId: string; status: JobStatus; progress: number; stage: StageId | null }
type Tone = "ok" | "error" | "info";
interface ToastItem { id: number; message: string; tone: Tone }

interface Ctx {
  records: NgoRecord[];
  byId: Map<string, NgoRecord>;
  facets: ReturnType<typeof facetsOf>;
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  patch: (id: string, p: NgoPatch) => Promise<boolean>;
  bulk: (ids: string[], p: NgoPatch, doneMessage?: string) => Promise<boolean>;
  addEntry: (body: Record<string, unknown>) => Promise<NgoRecord | null>;
  runs: Record<string, AuditRun>;
  audit: (ids: string[], opts?: { refresh?: boolean }) => Promise<void>;
  toast: (message: string, tone?: Tone) => void;
}

const NgoDataContext = React.createContext<Ctx | null>(null);
export function useNgoData() {
  const c = React.useContext(NgoDataContext);
  if (!c) throw new Error("useNgoData must be used inside <NgoDataProvider>");
  return c;
}

const ACTIVE: JobStatus[] = ["QUEUED", "RUNNING"];

export function NgoDataProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = React.useState<NgoRecord[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [runs, setRuns] = React.useState<Record<string, AuditRun>>({});
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const chains = React.useRef(new Map<string, Promise<unknown>>());
  const toastId = React.useRef(0);

  const toast = React.useCallback((message: string, tone: Tone = "ok") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 3200);
  }, []);

  const refresh = React.useCallback(async () => {
    try {
      const out = await api<{ records: NgoRecord[] }>("/api/ngos");
      setRecords(out.records); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load NGOs.");
    } finally { setLoaded(true); }
  }, []);

  React.useEffect(() => {
    let off = false;
    api<{ records: NgoRecord[] }>("/api/ngos")
      .then((o) => { if (!off) { setRecords(o.records); setError(null); } })
      .catch((e) => { if (!off) setError(e instanceof Error ? e.message : "Could not load NGOs."); })
      .finally(() => { if (!off) setLoaded(true); });
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { off = true; window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  const applyLocal = React.useCallback((ids: string[], p: NgoPatch) => {
    const now = new Date().toISOString();
    const set = new Set(ids);
    setRecords((rs) => rs.map((r) => (set.has(r.id) ? applyPatchLocal(r, p, now) : r)));
  }, []);

  const merge = React.useCallback((fresh: NgoRecord[]) => {
    const m = new Map(fresh.map((r) => [r.id, r]));
    setRecords((rs) => rs.map((r) => m.get(r.id) ?? r));
  }, []);

  // Writes for the same NGO are sent in order, so rapid toggles cannot arrive out of order.
  const enqueue = React.useCallback(<T,>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = chains.current.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    chains.current.set(key, next);
    return next;
  }, []);

  const patch = React.useCallback(async (id: string, p: NgoPatch) => {
    applyLocal([id], p);
    try {
      const out = await enqueue(id, () => api<{ record: NgoRecord }>(`/api/ngos/${id}`, { method: "PATCH", json: p }));
      merge([out.record]);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save that change.", "error");
      await refresh();
      return false;
    }
  }, [applyLocal, enqueue, merge, refresh, toast]);

  const bulk = React.useCallback(async (ids: string[], p: NgoPatch, doneMessage?: string) => {
    if (!ids.length) return false;
    applyLocal(ids, p);
    try {
      const url = Object.keys(p).length === 1 && p.inCrm === true ? "/api/ngos/bulk-add" : "/api/ngos/bulk-update";
      const out = await api<{ records: NgoRecord[] }>(url, { method: "POST", json: url.endsWith("bulk-add") ? { ids } : { ids, patch: p } });
      merge(out.records);
      if (doneMessage) toast(doneMessage);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save that change.", "error");
      await refresh();
      return false;
    }
  }, [applyLocal, merge, refresh, toast]);

  const addEntry = React.useCallback(async (body: Record<string, unknown>) => {
    try {
      const out = await api<{ record: NgoRecord; created: boolean }>("/api/ngos", { method: "POST", json: body });
      setRecords((rs) => (rs.some((r) => r.id === out.record.id) ? rs.map((r) => (r.id === out.record.id ? out.record : r)) : [out.record, ...rs]));
      toast(out.created ? `Added ${out.record.name}.` : `${out.record.name} is already in the directory.`, out.created ? "ok" : "info");
      return out.record;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add that NGO.", "error");
      return null;
    }
  }, [toast]);

  const audit = React.useCallback(async (ids: string[], opts: { refresh?: boolean } = {}) => {
    try {
      const out = await api<{ started: { ngoId: string; jobId: string }[]; skipped: { ngoId: string; reason: string }[] }>("/api/research/run", { method: "POST", json: { ngoIds: ids, refresh: !!opts.refresh } });
      setRuns((r) => ({ ...r, ...Object.fromEntries(out.started.map((s) => [s.ngoId, { jobId: s.jobId, status: "QUEUED" as JobStatus, progress: 0, stage: null }])) }));
      if (out.started.length) toast(`Started ${out.started.length} audit${out.started.length === 1 ? "" : "s"}. They run in the background.`, "info");
      if (out.skipped.length) toast(out.skipped.length === 1 ? out.skipped[0].reason : `${out.skipped.length} were skipped (already audited).`, "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start the audit.", "error");
    }
  }, [toast]);

  // Follow running audits until they finish, then reload the records they changed.
  const activeKey = Object.entries(runs).filter(([, r]) => ACTIVE.includes(r.status)).map(([id, r]) => `${id}:${r.jobId}`).join(",");
  React.useEffect(() => {
    if (!activeKey) return;
    let stop = false;
    const tick = async () => {
      const entries = activeKey.split(",").map((x) => x.split(":") as [string, string]);
      let finished = false;
      for (const [ngoId, jobId] of entries) {
        try {
          const j = await api<JobRecord>(`/api/research/${jobId}`);
          if (stop) return;
          setRuns((r) => ({ ...r, [ngoId]: { jobId, status: j.status, progress: j.progress, stage: j.stage } }));
          if (!ACTIVE.includes(j.status)) {
            finished = true;
            if (j.status === "COMPLETED" || j.status === "PARTIAL") toast("Audit finished.");
            else if (j.status === "FAILED") toast(j.error ?? "An audit failed.", "error");
            else if (j.status === "AWAITING_DISAMBIGUATION") toast("An audit needs you to choose the right organisation.", "info");
          }
        } catch { /* try again on the next tick */ }
      }
      if (finished) {
        await refresh();
        setRuns((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => !(v.status === "COMPLETED" || v.status === "PARTIAL"))));
      }
    };
    const t = setInterval(tick, 2500);
    return () => { stop = true; clearInterval(t); };
  }, [activeKey, refresh, toast]);

  const byId = React.useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const facets = React.useMemo(() => facetsOf(records), [records]);
  const value = React.useMemo<Ctx>(() => ({ records, byId, facets, loaded, error, refresh, patch, bulk, addEntry, runs, audit, toast }), [records, byId, facets, loaded, error, refresh, patch, bulk, addEntry, runs, audit, toast]);

  return (
    <NgoDataContext.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg ${t.tone === "error" ? "border-[var(--bad)] bg-card text-[var(--bad-ink)]" : t.tone === "info" ? "border-border bg-card" : "border-[color-mix(in_srgb,var(--ok)_50%,transparent)] bg-card"}`}>{t.message}</div>
        ))}
      </div>
    </NgoDataContext.Provider>
  );
}
