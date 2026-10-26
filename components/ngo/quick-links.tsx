"use client";

import * as React from "react";
import { ExternalLink, FileText, Globe, Link2, ShieldCheck, Users } from "lucide-react";
import type { NgoPayload } from "@/lib/server/view";
import { quickLinks, type QuickLink } from "@/lib/ui/quick-links";

function Chip({ l }: { l: QuickLink }) {
  return (
    <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.url}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm shadow-sm transition-colors hover:border-[var(--ring)] hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="truncate font-medium">{l.label}</span>
      {l.note && <span className="truncate text-xs text-muted-foreground">· {l.note}</span>}
      <ExternalLink className="size-3.5 shrink-0 opacity-60 group-hover:opacity-100" aria-hidden />
    </a>
  );
}

function Row({ icon: Icon, title, links, empty }: { icon: React.ComponentType<{ className?: string }>; title: string; links: QuickLink[]; empty?: string }) {
  if (!links.length && !empty) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_1fr] sm:items-start">
      <p className="flex items-center gap-2 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="size-4" />{title}</p>
      <div className="flex flex-wrap gap-2">{links.length ? links.map((l, i) => <Chip key={`${i}-${l.url}`} l={l} />) : <span className="pt-1.5 text-sm text-muted-foreground">{empty}</span>}</div>
    </div>
  );
}

/** One-click links to everything the audit found online. */
export function QuickLinks({ data }: { data: NgoPayload }) {
  const q = React.useMemo(() => quickLinks(data), [data]);
  return (
    <section aria-labelledby="ql-h" className="surface p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ql-h" className="font-serif text-xl">Found online</h2>
        <p className="text-xs text-muted-foreground">Click to open in a new tab. Only pages that actually loaded are listed.</p>
      </div>
      <div className="space-y-3">
        <Row icon={Globe} title="Website" links={q.website ? [{ ...q.website, label: q.website.label }] : []} empty="No official website found in the sources checked" />
        <Row icon={FileText} title="Pages on site" links={q.pages} empty={q.website ? "Only the home page could be opened" : undefined} />
        <Row icon={Users} title="Social" links={q.social} empty="No profiles found in the sources checked" />
        <Row icon={Link2} title="Elsewhere" links={q.other} />
        <Row icon={ShieldCheck} title="Verify" links={q.verify} />
      </div>
    </section>
  );
}
