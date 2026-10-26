"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { CopyButton, EmptyState, MetaChip, Notice, Spinner } from "@/components/shared";
import { api } from "@/lib/client/api";
import { CHANNELS, CHANNEL_LABEL, RUBRIC_MAX, TONES, TONE_LABEL, type Channel, type Tone } from "@/lib/pitch/types";
import type { PitchDraftView, PitchView } from "@/lib/research/store";
import type { NgoPayload } from "@/lib/server/view";
import { formatTime, TONE_HELP } from "@/lib/ui/labels";
import { cn } from "@/lib/utils";

const PLACEHOLDER = /\[\[.*?\]\]/;

export function PitchTab({ data, onChanged }: { data: NgoPayload; onChanged: () => Promise<void> }) {
  const [tone, setTone] = React.useState<Tone>(data.pitches[0]?.tone ?? "warm-professional");
  const [versionId, setVersionId] = React.useState<string | null>(null);
  const [channel, setChannel] = React.useState<Channel>("COLD_EMAIL");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const pitch: PitchView | undefined = data.pitches.find((p) => p.id === versionId) ?? data.pitches[0];
  const draft = pitch?.drafts.find((d) => d.channel === channel);

  async function regenerate() {
    setBusy(true); setErr(null);
    try {
      const p = await api<PitchView>(`/api/ngos/${data.ngo.id}/pitch`, { method: "POST", json: { tone } });
      setVersionId(p.id); await onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not regenerate."); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <Notice>These are <strong>drafts for your review</strong>. Nothing is sent from this app — copy a draft into your own email, WhatsApp or LinkedIn after you have read and edited it.</Notice>

      <section aria-labelledby="tone-h" className="rounded-md border border-border bg-card p-4">
        <h2 id="tone-h" className="font-serif text-lg">Tone</h2>
        <div role="radiogroup" aria-labelledby="tone-h" className="mt-3 grid gap-2 sm:grid-cols-3">
          {TONES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={tone === t} onClick={() => setTone(t)}
              className={cn("rounded-md border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tone === t ? "border-foreground bg-muted" : "border-border hover:bg-muted/60")}>
              <span className="block font-medium">{TONE_LABEL[t]}</span><span className="block text-xs text-muted-foreground">{TONE_HELP[t]}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={regenerate} disabled={busy}>{busy ? <Spinner label="Writing drafts…" /> : pitch ? "Regenerate in this tone" : "Generate drafts"}</Button>
          {pitch && data.pitches.length > 1 && (
            <label className="flex items-center gap-2 text-sm">Version
              <select value={pitch.id} onChange={(e) => setVersionId(e.target.value)} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
                {data.pitches.map((p) => <option key={p.id} value={p.id}>v{p.version} · {TONE_LABEL[p.tone]} · {formatTime(p.createdAt)}</option>)}
              </select>
            </label>
          )}
        </div>
        {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
        <p className="mt-2 text-xs text-muted-foreground">Regenerating keeps earlier versions. Findings or services you rejected are left out.</p>
      </section>

      {!pitch ? (
        <EmptyState title="No drafts yet">Generate drafts to see eight formats: cold email, WhatsApp, LinkedIn, phone script, follow-up, meeting request, one-page proposal and discovery questions.</EmptyState>
      ) : (
        <>
          {pitch.warnings.map((w, i) => <Notice key={i}>{w}</Notice>)}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <MetaChip>v{pitch.version}</MetaChip><MetaChip>{TONE_LABEL[pitch.tone]}</MetaChip>
            <MetaChip>{pitch.generatedBy === "deterministic" ? "Composed from the evidence" : pitch.generatedBy === "ai" ? "Polished with AI" : "Partly polished with AI"}</MetaChip>
            <MetaChip>Average rubric score {pitch.scoreTotal ?? "—"}/100</MetaChip>
          </div>

          <div role="tablist" aria-label="Channel" className="flex gap-1 overflow-x-auto border-b border-border">
            {CHANNELS.map((c) => {
              const d = pitch.drafts.find((x) => x.channel === c);
              return (
                <button key={c} role="tab" type="button" aria-selected={channel === c} onClick={() => setChannel(c)}
                  className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", channel === c ? "border-accent font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
                  {CHANNEL_LABEL[c]}{d?.status === "APPROVED" ? " ✓" : ""}
                </button>
              );
            })}
          </div>
          {draft ? <DraftEditor key={draft.id} draft={draft} onChanged={onChanged} /> : <EmptyState title="This format is not in this version" />}
        </>
      )}
    </div>
  );
}

function DraftEditor({ draft, onChanged }: { draft: PitchDraftView; onChanged: () => Promise<void> }) {
  const original = draft.body;
  const [text, setText] = React.useState(draft.editedBody ?? draft.body);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const dirty = text !== (draft.editedBody ?? draft.body);
  const hasPlaceholder = PLACEHOLDER.test(text) || (draft.subject ? PLACEHOLDER.test(draft.subject) : false);
  const area = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => { // grow the textarea to its content
    const el = area.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight + 4, 640)}px`;
  }, [text]);

  async function patch(json: object) {
    setBusy(true); setErr(null);
    try { await api(`/api/drafts/${draft.id}`, { method: "PATCH", json }); setSaved(true); setTimeout(() => setSaved(false), 1500); await onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(false); }
  }
  const errors = draft.lint.filter((l) => l.severity === "error");
  const warnings = draft.lint.filter((l) => l.severity === "warning");
  const cleanText = text;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-3">
        {draft.subject && (
          <div className="rounded-md border border-border bg-card p-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Subject</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-sm">{draft.subject}</p><CopyButton text={draft.subject} label="Copy subject" /></div>
          </div>
        )}
        <label htmlFor={`body-${draft.id}`} className="sr-only">Draft text</label>
        <textarea id={`body-${draft.id}`} ref={area} value={text} onChange={(e) => setText(e.target.value)} spellCheck
          className="min-h-56 w-full resize-y rounded-md border border-input bg-card p-4 font-sans text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={cleanText} label="Copy text" />
          <Button size="sm" variant="outline" disabled={busy || !dirty} onClick={() => patch({ editedBody: text, status: "DRAFT" })}>{saved ? "Saved" : "Save edits"}</Button>
          {(draft.editedBody !== null || dirty) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setText(original); void patch({ editedBody: null, status: "DRAFT" }); }}>Reset to original</Button>}
          <Button size="sm" variant={draft.status === "APPROVED" ? "default" : "accent"} disabled={busy || dirty || (draft.status !== "APPROVED" && (hasPlaceholder || errors.length > 0))}
            onClick={() => patch({ status: draft.status === "APPROVED" ? "DRAFT" : "APPROVED" })}
            title={hasPlaceholder ? "Fill in the [[placeholders]] first" : errors.length ? "Fix the flagged problems first" : dirty ? "Save your edits first" : undefined}>
            {draft.status === "APPROVED" ? "Approved — undo" : "Approve draft"}
          </Button>
        </div>
        {hasPlaceholder && <p className="text-xs text-muted-foreground" role="note">This draft contains <code className="rounded bg-muted px-1">[[placeholders]]</code> that need your input or approval before it can be marked approved. Set SENDER_NAME in .env to fill in your name automatically.</p>}
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        {(errors.length > 0 || warnings.length > 0) && (
          <ul className="space-y-1 text-sm" aria-label="Draft checks">
            {errors.map((l, i) => <li key={`e${i}`} className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"><strong>Fix before sending: </strong>{l.message}</li>)}
            {warnings.map((l, i) => <li key={`w${i}`} className="rounded-md border border-border px-3 py-2 text-muted-foreground">{l.message}</li>)}
          </ul>
        )}
      </div>

      <aside aria-label="Pitch quality" className="space-y-3 rounded-md border border-border bg-card p-4 text-sm">
        <div className="flex items-baseline justify-between"><h3 className="font-serif text-lg">Rubric</h3><span className="text-2xl tabular-nums">{draft.score ?? "—"}<span className="text-sm text-muted-foreground">/100</span></span></div>
        {draft.breakdown && (
          <ul className="space-y-2">
            {(Object.keys(RUBRIC_MAX) as (keyof typeof RUBRIC_MAX)[]).map((k) => (
              <li key={k}>
                <div className="flex justify-between text-xs"><span className="capitalize">{k === "cta" ? "Call to action" : k}</span><span className="tabular-nums">{draft.breakdown?.[k] ?? 0}/{RUBRIC_MAX[k]}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-accent" style={{ width: `${((draft.breakdown?.[k] ?? 0) / RUBRIC_MAX[k]) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        )}
        {draft.notes.length > 0 && <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{draft.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        <p className="text-xs text-muted-foreground">The score checks measurable properties — specific, evidenced, relevant, clear value, one ask, courteous. It does not predict a reply. It describes the original draft, not your edits.</p>
      </aside>
    </div>
  );
}
