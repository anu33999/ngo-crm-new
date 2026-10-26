"use client";

import * as React from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfidenceChip, MetaChip, PriorityChip, StateBadge } from "@/components/shared";
import { cn } from "@/lib/utils";
import type { EvidenceView, FindingView } from "@/lib/research/store";
import { FETCH_LABEL, formatTime, hostOf, SOURCE_LABEL } from "@/lib/ui/labels";

/** url → stored evidence record, so every citation shows source type, retrieval status and timestamp. */
export const EvidenceContext = React.createContext<Map<string, EvidenceView>>(new Map());

export function SourceList({ urls }: { urls: string[] }) {
  const evidence = React.useContext(EvidenceContext);
  if (!urls.length) return <p className="text-xs text-muted-foreground">No source pages were retrieved for this item.</p>;
  return (
    <ul className="space-y-2">
      {urls.map((u) => {
        const e = evidence.get(u);
        return (
          <li key={u} className="rounded-md border border-border bg-background/60 p-2.5 text-xs">
            <a href={u} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-start gap-1 font-medium underline decoration-border underline-offset-2 hover:decoration-foreground">
              <span className="break-all">{e?.title || hostOf(u)}</span> <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
            </a>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
              {e && <span>{SOURCE_LABEL[e.sourceType]}{e.isOfficial ? " (official)" : ""}</span>}
              {e && <span>{FETCH_LABEL[e.fetchStatus]}</span>}
              {e && <span>Checked {formatTime(e.checkedAt)}</span>}
            </div>
            {(e?.snapshot || e?.summary) && <p className="mt-1.5 line-clamp-3 text-muted-foreground">“{e.summary || e.snapshot}”</p>}
            {e?.failureReason && e.fetchStatus !== "OK" && e.fetchStatus !== "NOT_ATTEMPTED" && <p className="mt-1 text-muted-foreground">Reason: {e.failureReason}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** Compact finding card. Details and sources expand on demand. `actions` is where review controls go. */
export function FindingCard({
  finding, rank, actions, defaultOpen = false, className,
}: { finding: FindingView; rank?: number; actions?: React.ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  const excluded = finding.reviewStatus === "EXCLUDED" || finding.reviewStatus === "REJECTED";
  return (
    <article className={cn("rounded-md border border-border bg-card p-4", excluded && "opacity-60", className)} aria-labelledby={`${id}-t`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        {rank !== undefined && <span className="font-serif text-2xl leading-none text-muted-foreground" aria-label={`Rank ${rank}`}>{rank}</span>}
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-t`} className="text-[15px] font-semibold leading-snug">{finding.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {finding.gapState && <StateBadge state={finding.gapState} />}
            {finding.priority && <PriorityChip value={finding.priority} />}
            <ConfidenceChip value={finding.confidence} />
            {finding.mayAddressOffline && <MetaChip>May be handled offline</MetaChip>}
            {finding.reviewStatus !== "PENDING" && <MetaChip className="border-foreground/30 text-foreground">{finding.reviewStatus === "APPROVED" ? "Approved" : finding.reviewStatus === "EXCLUDED" ? "Excluded from NGO-facing output" : "Rejected"}</MetaChip>}
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed">{finding.observation}</p>
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`${id}-d`}
        className="mt-3 inline-flex min-h-8 items-center gap-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
        {open ? "Hide" : "Show"} why it matters and {finding.evidenceUrls.length} source{finding.evidenceUrls.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div id={`${id}-d`} className="mt-2 space-y-3 border-t border-border pt-3 text-sm">
          {finding.whyItMatters && <p><span className="font-medium">Why it matters. </span>{finding.whyItMatters}</p>}
          {finding.consequence && <p><span className="font-medium">If left as it is. </span>{finding.consequence}</p>}
          {finding.recommendedAction && <p><span className="font-medium">Suggested action. </span>{finding.recommendedAction}</p>}
          <p className="text-xs text-muted-foreground">Checked {formatTime(finding.checkedAt)}</p>
          <SourceList urls={finding.evidenceUrls} />
          {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
        </div>
      )}
    </article>
  );
}

export function ReviewActions({ finding, onReview, busy }: { finding: FindingView; onReview: (status: FindingView["reviewStatus"]) => void; busy?: boolean }) {
  return (
    <>
      <Button size="sm" variant={finding.reviewStatus === "APPROVED" ? "default" : "outline"} disabled={busy} onClick={() => onReview(finding.reviewStatus === "APPROVED" ? "PENDING" : "APPROVED")}>
        {finding.reviewStatus === "APPROVED" ? "Approved" : "Approve"}
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onReview(finding.reviewStatus === "REJECTED" ? "PENDING" : "REJECTED")}>
        {finding.reviewStatus === "REJECTED" ? "Rejected — undo" : "Reject"}
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onReview(finding.reviewStatus === "EXCLUDED" ? "PENDING" : "EXCLUDED")} title="Never shown in NGO-facing reports">
        {finding.reviewStatus === "EXCLUDED" ? "Excluded — undo" : "Exclude (sensitive)"}
      </Button>
    </>
  );
}
