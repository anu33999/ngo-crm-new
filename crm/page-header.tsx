import * as React from "react";

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow: string; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="hero mb-5">
      <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"><span className="inline-block h-px w-6 bg-[var(--accent)]" aria-hidden />{eyebrow}</p>
          <h1 className="mt-1.5 font-serif text-3xl leading-tight sm:text-[2.6rem]">{title}</h1>
          {children && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{children}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export interface Stat { label: string; value: number | string; tone?: "ok" | "warn" | "info" | "bad" | "gold"; hint?: string; onClick?: () => void; active?: boolean }
const TONE: Record<NonNullable<Stat["tone"]>, string> = { ok: "var(--ok)", warn: "var(--warn)", info: "var(--info)", bad: "var(--bad)", gold: "var(--primary)" };

/** Colour-coded summary tiles; clickable ones act as quick filters. */
export function StatStrip({ items }: { items: Stat[] }) {
  return (
    <ul className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((s) => {
        const inner = (<><p className="v tabular-nums">{s.value}</p><p className="mt-0.5 text-xs text-muted-foreground">{s.label}</p></>);
        return (
          <li key={s.label} className={`stat-tile ${s.active ? "ring-2 ring-[var(--ring)]" : ""}`} style={{ ["--tone" as string]: TONE[s.tone ?? "gold"] }} title={s.hint}>
            {s.onClick ? <button type="button" onClick={s.onClick} aria-pressed={!!s.active} className="block w-full text-left focus-visible:outline-none">{inner}</button> : inner}
          </li>
        );
      })}
    </ul>
  );
}

export const selectCls = "h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
