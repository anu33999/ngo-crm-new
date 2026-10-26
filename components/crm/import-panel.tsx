"use client";

import * as React from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/shared";
import { TWIN_CITIES } from "@/lib/crm/types";
import { useNgoData } from "./ngo-data";
import { selectCls } from "./page-header";

interface Preview {
  preview: boolean; sheet: string; headerRow: number; rowsRead: number;
  columns: { header: string; field: string }[]; unusedColumns: string[]; warnings: string[]; skipped: { row: number; name?: string; reason: string }[]; skippedCount: number;
  willAdd?: number; alreadyPresent: number; added?: number; filled?: number; sample?: { name: string; city: string; phone: string | null; website: string | null }[];
}

async function send(file: File, city: string, preview: boolean): Promise<Preview> {
  const fd = new FormData();
  fd.set("file", file); fd.set("defaultCity", city); if (preview) fd.set("preview", "1");
  const res = await fetch("/api/directory/import", { method: "POST", body: fd, cache: "no-store" });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `Import failed (${res.status}).`);
  return data as Preview;
}

/** Choose a .xlsx/.csv → see exactly what would happen → confirm. Nothing is written until you confirm. */
export function ImportPanel({ onClose }: { onClose: () => void }) {
  const { refresh, toast } = useNgoData();
  const [file, setFile] = React.useState<File | null>(null);
  const [city, setCity] = React.useState("Hyderabad");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [pv, setPv] = React.useState<Preview | null>(null);
  const [done, setDone] = React.useState<Preview | null>(null);

  async function check(f: File | null, c: string) {
    setErr(null); setPv(null); setDone(null);
    if (!f) return;
    setBusy(true);
    try { setPv(await send(f, c, true)); } catch (e) { setErr(e instanceof Error ? e.message : "Could not read that file."); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const out = await send(file, city, false);
      setDone(out); setPv(null);
      await refresh();
      toast(`Imported ${out.added ?? 0} new NGO${out.added === 1 ? "" : "s"}.`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Import failed."); } finally { setBusy(false); }
  }

  return (
    <section className="mt-4 surface p-4" aria-labelledby="imp-h">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="imp-h" className="flex items-center gap-2 font-serif text-lg"><FileSpreadsheet className="size-5" aria-hidden /> Import a spreadsheet</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Add more NGOs from an .xlsx or .csv file. Columns are matched by their heading (NGO Name, Location, Category, Phone, Website, Email, Contact Person, Priority, Contact Status, Next Action, Notes and so on), in any order.
            You will see a summary first. NGOs already in your list only get their <em>empty</em> fields filled — nothing you typed is overwritten and no contact status is changed.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="imp-file" className="mb-1 block text-xs font-medium">File (.xlsx or .csv, up to 5 MB)</label>
          <input id="imp-file" type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); void check(f, city); }}
            className="block w-full max-w-xs text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm" />
        </div>
        <div>
          <label htmlFor="imp-city" className="mb-1 block text-xs font-medium">City for rows without one</label>
          <select id="imp-city" value={city} onChange={(e) => { setCity(e.target.value); void check(file, e.target.value); }} className={`${selectCls} w-44`}>
            {TWIN_CITIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {busy && <Spinner label="Working…" />}
      </div>

      {err && <p role="alert" className="mt-3 text-sm text-destructive">{err}</p>}

      {pv && (
        <div className="mt-4 space-y-3 text-sm" aria-live="polite">
          <p><strong>{pv.rowsRead} row{pv.rowsRead === 1 ? "" : "s"}</strong> read from sheet “{pv.sheet}” (headings on row {pv.headerRow}). <strong>{pv.willAdd}</strong> new, <strong>{pv.alreadyPresent}</strong> already in your list{pv.skippedCount ? <>, <strong>{pv.skippedCount}</strong> skipped</> : null}.</p>
          <div>
            <p className="mb-1 text-xs font-medium">Columns recognised</p>
            <ul className="flex flex-wrap gap-1.5">{pv.columns.map((c) => <li key={c.header} className="pill pill-ok">{c.header}</li>)}</ul>
            {pv.unusedColumns.length > 0 && <p className="mt-1.5 text-xs text-muted-foreground">Not imported (not recognised): {pv.unusedColumns.join(", ")}</p>}
          </div>
          {pv.sample && pv.sample.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium">First rows</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">{pv.sample.map((s) => <li key={s.name}>{s.name} · {s.city} · {s.phone ?? "no phone"} · {s.website ?? "no website"}</li>)}</ul>
            </div>
          )}
          {pv.warnings.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{pv.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          {pv.skipped.length > 0 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Skipped rows ({pv.skippedCount})</summary><ul className="mt-1 list-disc pl-5">{pv.skipped.map((s) => <li key={s.row}>Row {s.row}{s.name ? ` (${s.name})` : ""}: {s.reason}</li>)}</ul></details>}
          <div className="flex gap-2">
            <Button onClick={confirm} disabled={busy || (pv.willAdd === 0 && pv.alreadyPresent === 0)}>
              {pv.willAdd ? `Import ${pv.willAdd} new NGO${pv.willAdd === 1 ? "" : "s"}` : "Fill empty fields only"}
            </Button>
            <Button variant="ghost" onClick={() => { setFile(null); setPv(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {done && (
        <div className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm" role="status">
          <strong>Done.</strong> {done.added} new NGO{done.added === 1 ? "" : "s"} added; {done.alreadyPresent} were already in your list ({done.filled} had empty fields filled in).
          {done.warnings.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{done.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          <div className="mt-2"><Button size="sm" variant="outline" onClick={onClose}>Close</Button></div>
        </div>
      )}
    </section>
  );
}
