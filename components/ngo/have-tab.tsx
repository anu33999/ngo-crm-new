"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import { FindingCard } from "@/components/evidence-card";
import { SourceList } from "@/components/evidence-card";
import { EmptyState, MetaChip, SectionTitle } from "@/components/shared";
import type { NgoPayload } from "@/lib/server/view";
import { COMPLIANCE_LABEL, formatTime, NOT_ENOUGH } from "@/lib/ui/labels";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  WEBSITE: "Website", SEO: "Search and discoverability", SOCIAL: "Social media", COMPLIANCE: "Registrations", COMMUNICATIONS: "Communications", BRAND: "Brand",
  DONATION_VOLUNTEER: "Donation and volunteering", IMPACT_REPORTING: "Impact and reporting", CONTENT_MEDIA: "Content and media", ANALYTICS: "Analytics", PRIVACY_ACCESSIBILITY: "Privacy and accessibility", OTHER: "Other",
};
const PLATFORM_LABEL: Record<string, string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", LINKEDIN: "LinkedIn", YOUTUBE: "YouTube", X: "X", OTHER: "Other" };

export function HaveTab({ data }: { data: NgoPayload }) {
  const existing = data.findings.filter((f) => f.section === "EXISTING" && f.reviewStatus !== "REJECTED");
  const grouped = new Map<string, typeof existing>();
  for (const f of existing) grouped.set(f.category, [...(grouped.get(f.category) ?? []), f]);

  return (
    <div className="space-y-10">
      <section aria-labelledby="have-presence">
        <SectionTitle hint="What we could observe on the public web. Each item links to where it was seen.">What they already have</SectionTitle>
        {existing.length === 0 ? (
          <EmptyState title="Nothing could be confirmed yet">The official website could not be reviewed, so there are no confirmed strengths to list. See “Unable to assess” items under What They Lack.</EmptyState>
        ) : (
          <div className="space-y-6">
            {[...grouped.entries()].map(([cat, items]) => (
              <div key={cat}>
                <h3 id={`have-${cat}`} className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{CATEGORY_LABEL[cat] ?? cat}</h3>
                <div className="grid gap-3 lg:grid-cols-2" role="group" aria-labelledby={`have-${cat}`}>
                  {items.map((f) => <FindingCard key={f.id} finding={f} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="have-social">
        <SectionTitle hint="Social platforms restrict automated access. A profile is listed when the NGO's website links to it or search results show a matching handle. Posting frequency and quality were not assessed.">Social profiles</SectionTitle>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">Social profiles located for this NGO</caption>
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th scope="col" className="px-3 py-2 font-medium">Platform</th><th scope="col" className="px-3 py-2 font-medium">Profile</th><th scope="col" className="px-3 py-2 font-medium">Basis</th></tr>
            </thead>
            <tbody>
              {data.social.map((s) => (
                <tr key={s.platform} className="border-t border-border align-top">
                  <th scope="row" className="px-3 py-2 font-medium">{PLATFORM_LABEL[s.platform]}</th>
                  <td className="px-3 py-2">
                    {s.url ? <a className="inline-flex items-center gap-1 break-all underline underline-offset-2" href={s.url} target="_blank" rel="noopener noreferrer">{s.url.replace(/^https?:\/\/(www\.)?/, "")}<ExternalLink className="size-3" aria-hidden /></a> : <span className="text-muted-foreground">Not found in the sources checked</span>}
                    {s.url && !s.isOfficial && <div className="mt-1"><MetaChip>Unconfirmed — verify it is official</MetaChip></div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{s.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="have-compliance">
        <SectionTitle hint="We read these from the NGO's own pages, directories and search results. The official registers are not queried automatically — use the link on each item to verify. ‘Not found’ is never proof that something does not exist.">Registrations and compliance signals</SectionTitle>
        <ul className="grid gap-3 md:grid-cols-2">
          {(data.identity?.compliance ?? []).map((c) => (
            <li key={c.key} className="rounded-md border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{c.key}</h3>
                <MetaChip className={cn(c.status === "VERIFIED" && "border-foreground/40 text-foreground")}>{COMPLIANCE_LABEL[c.status]}</MetaChip>
              </div>
              <p className="mt-2 text-sm leading-relaxed">{c.statement}</p>
              {c.evidenceUrls.length > 0 && <details className="mt-2 text-sm"><summary className="cursor-pointer text-xs text-muted-foreground">{c.evidenceUrls.length} source{c.evidenceUrls.length === 1 ? "" : "s"}</summary><div className="mt-2"><SourceList urls={c.evidenceUrls} /></div></details>}
              <a href={c.officialLookup.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs underline underline-offset-2">Verify on {c.officialLookup.name} <ExternalLink className="size-3" aria-hidden /></a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="have-readiness">
        <SectionTitle hint="Measures observable digital readiness only — not the quality or impact of the NGO's work. A category with too little evidence shows ‘Not enough evidence’ rather than a zero.">Digital readiness</SectionTitle>
        {data.analysis && (
          <>
            <p className="mb-3 text-sm">Overall: <strong>{data.analysis.readiness.overall === null ? NOT_ENOUGH : `${data.analysis.readiness.overall} / 100`}</strong></p>
            <ul className="grid gap-3 md:grid-cols-2">
              {data.analysis.readiness.categories.map((c) => (
                <li key={c.id} className="rounded-md border border-border bg-card p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold">{c.label}</h3>
                    <span className="shrink-0 text-sm tabular-nums">{c.score === null ? <span className="text-muted-foreground">{NOT_ENOUGH}</span> : `${c.score} / 100`}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={c.score === null ? NOT_ENOUGH : `${c.score} out of 100`}>
                    {c.score !== null && <div className="h-full bg-accent" style={{ width: `${c.score}%` }} />}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{c.note}</p>
                  <ul className="mt-2 flex flex-wrap gap-1">{c.checks.map((k) => <li key={k.key}><MetaChip className={cn(k.result === "pass" && "text-foreground", k.result === "unknown" && "border-dashed")}>{k.title ?? k.key}: {k.result === "pass" ? "ok" : k.result === "fail" ? "issue" : k.result === "not-found" ? "not found" : "unknown"}</MetaChip></li>)}</ul>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Last researched {formatTime(data.ngo.lastResearchedAt)}.</p>
      </section>
    </div>
  );
}
