import type { Recommendation } from "@/lib/research/match";
import type { ResearchResult } from "@/lib/research/store";
import type { DarpanStatus, WebsiteStatus } from "./types";

/**
 * Short, honest, evidence-derived summary for the CRM row (two lines). Nothing here is invented:
 * it restates the top evidenced finding and the catalogue services already matched to it.
 */
export function buildPitchSummary(r: Pick<ResearchResult, "findings" | "recommendations" | "analysis">): string {
  const topKey = r.analysis.top[0]?.areaId;
  const topFinding = topKey ? r.findings.find((f) => f.key === `area.${topKey}`) : undefined;
  const recs = r.recommendations.filter((x: Recommendation) => (x.level as string) !== "DO_NOT_PITCH");
  const names = [...new Set(recs.map((x) => x.serviceName))].slice(0, 2);
  const label = topFinding?.gapState === "CONFIRMED_ISSUE" ? "Observed" : "Possible opportunity";
  const line1 = topFinding ? `${label}: ${topFinding.title}.` : "No evidence-backed gap stood out in the public sources checked.";
  const line2 = names.length ? `Start with: ${names.join("; ")}.` : "Run discovery questions before suggesting any service.";
  return `${line1}\n${line2}`;
}

export function websiteStatusOf(r: { officialSite: string | null }, siteAssessable: boolean): WebsiteStatus {
  if (!r.officialSite) return "NOT_FOUND_PUBLICLY";
  return siteAssessable ? "REACHABLE" : "UNABLE_TO_ASSESS";
}

export function darpanStatusOf(compliance: ResearchResult["compliance"]): DarpanStatus {
  const item = compliance.find((c) => c.key === "NGO Darpan");
  if (!item) return "UNKNOWN";
  if (item.status === "VERIFIED") return "VERIFIED";
  if (item.status === "UNVERIFIED") return "UNVERIFIED";
  if (item.status === "NOT_FOUND") return "NOT_FOUND";
  return "UNKNOWN";
}

const PHONE = /^\+?[\d\s().-]{7,18}$/;
/** First usable phone/email published on the NGO's own pages (they are the NGO's own published contact details). */
export function pickContact(pages: { tel: string[]; mailto: string[] }[]): { phone?: string; email?: string } {
  const out: { phone?: string; email?: string } = {};
  for (const p of pages) {
    for (const t of p.tel) {
      const v = decodeURIComponent(t).trim();
      if (!out.phone && PHONE.test(v) && v.replace(/\D/g, "").length >= 8) out.phone = v.slice(0, 24);
    }
    for (const m of p.mailto) {
      const v = decodeURIComponent(m).trim().toLowerCase();
      if (!out.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 120) out.email = v;
    }
  }
  return out;
}
