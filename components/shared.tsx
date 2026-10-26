"use client";

import * as React from "react";
import { Check, CircleAlert, Copy, Lightbulb, LoaderCircle, SearchX, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Confidence, GapState, Priority } from "@/lib/research/types";
import { CONFIDENCE_LABEL, PRIORITY_LABEL, STATE_HELP, STATE_LABEL, STATE_STYLE } from "@/lib/ui/labels";

const STATE_ICON = { CONFIRMED_ISSUE: CircleAlert, LIKELY_OPPORTUNITY: Lightbulb, NOT_FOUND_PUBLICLY: SearchX, UNABLE_TO_ASSESS: CircleHelp } as const;

export function StateBadge({ state, className }: { state: GapState; className?: string }) {
  const Icon = STATE_ICON[state];
  return (
    <span title={STATE_HELP[state]} className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium", STATE_STYLE[state], className)}>
      <Icon className="size-3.5" aria-hidden /> {STATE_LABEL[state]}
    </span>
  );
}

export function MetaChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground", className)}>{children}</span>;
}
export const ConfidenceChip = ({ value }: { value: Confidence }) => <MetaChip>{CONFIDENCE_LABEL[value]}</MetaChip>;
export const PriorityChip = ({ value }: { value: Priority }) => <MetaChip className={value === "CRITICAL" || value === "HIGH" ? "text-foreground" : undefined}>{PRIORITY_LABEL[value]}</MetaChip>;

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" aria-hidden /> {label ?? "Loading…"}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-md border p-3 text-sm", tone === "warn" ? "border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-accent/60" : "border-border bg-muted/60")}>{children}</div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
      }
      setDone(true); setFailed(false);
      setTimeout(() => setDone(false), 1800);
    } catch { setFailed(true); }
  };
  return (
    <Button type="button" size="sm" variant="outline" onClick={copy} className={className} aria-live="polite">
      {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {failed ? "Copy failed — select the text" : done ? "Copied" : label}
    </Button>
  );
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="font-serif text-xl leading-tight">{children}</h2>
      {hint && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}
