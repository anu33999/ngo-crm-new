"use client";

import * as React from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton, ErrorBox, Spinner } from "@/components/shared";
import { api } from "@/lib/client/api";
import { telHref, whatsappHref, type NgoRecord } from "@/lib/crm/types";
import { CHANNELS, CHANNEL_LABEL, type Channel } from "@/lib/pitch/types";
import type { NgoPayload } from "@/lib/server/view";

/** Native <dialog>: focus is trapped, Escape closes it, and the page behind is inert while it is open. */
export function PitchModal({ record, onClose }: { record: NgoRecord; onClose: () => void }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const [data, setData] = React.useState<NgoPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [channel, setChannel] = React.useState<Channel>("COLD_EMAIL");

  React.useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { if (d?.open) d.close(); };
  }, []);
  React.useEffect(() => {
    if (!record.audited) return;
    let off = false;
    api<NgoPayload>(`/api/ngos/${record.id}`)
      .then((p) => { if (!off) setData(p); })
      .catch((e) => { if (!off) setError(e instanceof Error ? e.message : "Could not load the pitch."); });
    return () => { off = true; };
  }, [record.id, record.audited]);

  const pitch = data?.pitches[0];
  const draft = pitch?.drafts.find((d) => d.channel === channel);
  const body = draft ? (draft.editedBody ?? draft.body) : "";
  const wa = channel === "WHATSAPP" ? whatsappHref(record.phone, body) : null;

  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-labelledby="pm-h"
      className="m-auto w-[min(48rem,calc(100vw-1.5rem))] max-h-[calc(100vh-2rem)] overflow-hidden rounded-md border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/60">
      <div className="flex max-h-[calc(100vh-2rem)] flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Pitch drafts</p>
            <h2 id="pm-h" className="truncate font-serif text-xl">{record.name}</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="size-4" aria-hidden /></Button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          {record.pitchSummary && <p className="whitespace-pre-line rounded-md bg-muted/60 p-3 text-sm">{record.pitchSummary}</p>}
          {!record.audited && (
            <p className="text-sm text-muted-foreground">There is no pitch yet because this NGO has not been audited. Run a Deep Audit from the Discovery tab (or search for it by name) and its drafts will appear here.</p>
          )}
          {record.audited && error && <ErrorBox message={error} />}
          {record.audited && !data && !error && <Spinner label="Loading drafts…" />}
          {data && !pitch && <p className="text-sm text-muted-foreground">No drafts were generated for this audit. Open the audit and use <em>The Pitch</em> tab to generate them.</p>}
          {pitch && (
            <>
              <div role="tablist" aria-label="Outreach formats" className="flex flex-wrap gap-1">
                {CHANNELS.map((c) => (
                  <button key={c} role="tab" aria-selected={c === channel} onClick={() => setChannel(c)}
                    className={`rounded-md border px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${c === channel ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>
                    {CHANNEL_LABEL[c]}
                  </button>
                ))}
              </div>
              {draft ? (
                <div role="tabpanel" className="space-y-3">
                  {draft.subject && <p className="text-sm"><span className="text-muted-foreground">Subject: </span><strong>{draft.subject}</strong></p>}
                  <pre className="max-h-[22rem] overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-sans text-sm leading-relaxed">{body}</pre>
                  <div className="flex flex-wrap items-center gap-2">
                    <CopyButton text={draft.subject ? `Subject: ${draft.subject}\n\n${body}` : body} label={`Copy ${CHANNEL_LABEL[channel].toLowerCase()}`} />
                    {wa && <Button asChild size="sm" variant="outline"><a href={wa} target="_blank" rel="noopener noreferrer">Open in WhatsApp</a></Button>}
                    {telHref(record.phone) && channel === "PHONE_SCRIPT" && <Button asChild size="sm" variant="outline"><a href={telHref(record.phone) as string}>Call {record.phone}</a></Button>}
                    <span className="text-xs text-muted-foreground">Draft · {draft.status === "APPROVED" ? "approved by you" : "not yet approved"} · nothing is sent automatically</span>
                  </div>
                </div>
              ) : <p className="text-sm text-muted-foreground">No draft for this format.</p>}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3 text-xs text-muted-foreground">
          <span>Review, edit and approve drafts on the audit page before sending.</span>
          {record.audited && <Link href={`/ngo/${record.id}`} className="underline underline-offset-2">Open full audit &amp; pitch</Link>}
        </div>
      </div>
    </dialog>
  );
}
