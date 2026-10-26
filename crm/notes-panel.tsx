"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import { NOTE_MAX, type CrmNoteView, type NgoRecord } from "@/lib/crm/types";
import { formatTime } from "@/lib/ui/labels";
import { useNgoData } from "./ngo-data";

/** Free-form notes autosave when the field loses focus; the activity log keeps timestamped entries. */
export function NotesPanel({ record }: { record: NgoRecord }) {
  const { patch, toast } = useNgoData();
  const [text, setText] = React.useState(record.notes ?? "");
  const [state, setState] = React.useState<"idle" | "saving" | "saved">("idle");
  const [log, setLog] = React.useState<CrmNoteView[]>([]);
  const [entry, setEntry] = React.useState("");
  const lastSaved = React.useRef(record.notes ?? "");

  const loadLog = React.useCallback(async () => {
    try { setLog((await api<{ notes: CrmNoteView[] }>(`/api/ngos/${record.id}/notes`)).notes); } catch { /* the log is optional */ }
  }, [record.id]);
  React.useEffect(() => {
    let off = false;
    api<{ notes: CrmNoteView[] }>(`/api/ngos/${record.id}/notes`).then((o) => { if (!off) setLog(o.notes); }).catch(() => undefined);
    return () => { off = true; };
  }, [record.id, record.contactStatus, record.interestStatus]);

  async function save() {
    if (text === lastSaved.current) return;
    setState("saving");
    const ok = await patch(record.id, { notes: text.trim() ? text : null });
    if (ok) { lastSaved.current = text; setState("saved"); setTimeout(() => setState("idle"), 1600); } else setState("idle");
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const content = entry.trim();
    if (!content) return;
    try {
      await api(`/api/ngos/${record.id}/notes`, { method: "POST", json: { content } });
      setEntry(""); await loadLog();
    } catch (x) { toast(x instanceof Error ? x.message : "Could not add that note.", "error"); }
  }

  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      <div>
        <label htmlFor={`n-${record.id}`} className="mb-1 flex items-center justify-between text-xs font-medium">
          <span>Notes for {record.name}</span>
          <span className="font-normal text-muted-foreground" aria-live="polite">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Saves when you click away"}</span>
        </label>
        <textarea id={`n-${record.id}`} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} rows={5} maxLength={NOTE_MAX}
          placeholder="e.g. Spoke to the programme head. Asked for a proposal by Friday."
          className="w-full rounded-md border border-input bg-card p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <label htmlFor={`f-${record.id}`}>Follow up on</label>
          <Input id={`f-${record.id}`} type="date" className="h-8 w-40" value={record.followUpAt ? record.followUpAt.slice(0, 10) : ""}
            onChange={(e) => void patch(record.id, e.target.value ? { followUpAt: new Date(`${e.target.value}T09:00:00`).toISOString(), contactStatus: "FOLLOW_UP_SCHEDULED" } : { followUpAt: null })} />
        </div>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-medium">Activity</h3>
        <form onSubmit={add} className="mb-2 flex gap-2">
          <label htmlFor={`e-${record.id}`} className="sr-only">Add an activity note</label>
          <Input id={`e-${record.id}`} value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="Log a call, message or meeting…" maxLength={500} className="h-8" />
          <Button type="submit" size="sm" variant="outline" disabled={!entry.trim()}>Add</Button>
        </form>
        <ul className="max-h-40 space-y-1.5 overflow-y-auto text-xs">
          {log.length === 0 && <li className="text-muted-foreground">No activity yet. Status changes are logged here automatically.</li>}
          {log.map((n) => <li key={n.id} className="rounded border border-border px-2 py-1"><span className="text-muted-foreground">{formatTime(n.createdAt)} · {n.author}</span><br />{n.content}</li>)}
        </ul>
      </div>
    </div>
  );
}
