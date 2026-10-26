import ExcelJS from "exceljs";
import React from "react";
import { assertClientSafe, formatInr, type PricingSection } from "@/lib/pricing/policy";
import type { FindingView, NgoView, RecommendationView } from "@/lib/research/store";
import { STATE_LABEL, CONFIDENCE_LABEL, PRIORITY_LABEL, SOURCE_LABEL, LEVEL_LABEL } from "@/lib/ui/labels";
import { CONTACT_LABEL, INTEREST_LABEL } from "@/lib/crm/types";
import { csvSafe } from "./crm";

/**
 * Per-NGO documents.
 *   INTERNAL    — everything, including scores, review state and pricing detail. For the Kreatif Atelier team only.
 *   NGO_FACING  — what is safe to hand to the NGO: no scores, no internal economics, nothing a person rejected or
 *                 excluded, and every sentence hedged to the strength of its evidence. Always checked with
 *                 `assertClientSafe` before it is produced.
 */

export type ExportMode = "INTERNAL" | "NGO_FACING";
export interface Section { heading: string; paragraphs?: string[]; bullets?: string[]; table?: { head: string[]; rows: string[][] } }
export interface DocModel { title: string; subtitle: string; draftNotice?: string; sections: Section[]; footer: string }

export class ExportBlocked extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

const usable = (f: FindingView) => f.reviewStatus !== "REJECTED" && f.reviewStatus !== "EXCLUDED";
const day = (iso: string) => iso.slice(0, 10);

function pricingBlock(p: PricingSection, mode: ExportMode): Section {
  const bullets: string[] = [];
  if (p.status !== "APPROVED") {
    bullets.push(mode === "NGO_FACING" ? "Pricing will be shared once Kreatif Atelier has confirmed the terms for your organisation." : "No approved pricing policy is active — pricing needs human approval before any figure is quoted.");
  } else {
    bullets.push(p.headline);
    if (p.subsidizedScope.length) bullets.push(`At no professional fee: ${p.subsidizedScope.map((s) => s.name).join("; ")}.`);
    if (p.monthlyMaintenance) bullets.push(`${p.monthlyMaintenance.label}: ${p.monthlyMaintenance.amountInr === null ? "to be confirmed" : formatInr(p.monthlyMaintenance.amountInr)} — ${p.monthlyMaintenance.basis}`);
    for (const l of p.oneTime) bullets.push(`${l.label}: ${l.amountInr === null ? "to be quoted" : formatInr(l.amountInr)} — ${l.basis}`);
    if (p.requiresSeparateApproval.length) bullets.push(`Quoted separately: ${p.requiresSeparateApproval.map((s) => s.name).join("; ")}.`);
    bullets.push(p.gstNote);
    if (p.passThrough.length) bullets.push(`Paid directly by your organisation: ${p.passThrough.join("; ")}.`);
    bullets.push(...p.notes);
  }
  return { heading: "Pricing", bullets };
}

function recLine(r: RecommendationView) {
  return `${r.serviceName} (${r.serviceCode}) — ${r.proposedDeliverables} Expected outcome: ${r.expectedOutcome}`;
}

export function internalReport(view: NgoView, pricing: PricingSection, generatedAt: string): DocModel {
  const a = view.analysis;
  const sections: Section[] = [];
  sections.push({
    heading: "Summary",
    bullets: [
      `Location: ${view.ngo.location ?? "not recorded"}. Website: ${view.identity?.officialWebsite ?? "not found publicly"}.`,
      `Digital readiness (observable only): ${a?.readiness.overall ?? "Not enough evidence"}${a?.readiness.overall != null ? " / 100" : ""}.`,
      `Prospect priority (internal): ${a?.opportunity?.total ?? "—"} / 100.`,
      `Outreach: ${CONTACT_LABEL[view.ngo.contactStatus]} · ${INTEREST_LABEL[view.ngo.interestStatus]}.`,
      `Researched ${view.ngo.lastResearchedAt ? day(view.ngo.lastResearchedAt) : "—"}. Identity: ${view.ngo.identityStatus}.`,
    ],
  });
  if (a?.opportunity) sections.push({ heading: "How the priority score is built (internal)", table: { head: ["Criterion", "Points", "Max", "Basis"], rows: a.opportunity.breakdown.map((b) => [b.criterion, String(b.points), String(b.max), b.reason]) } });
  if (a) sections.push({ heading: "Readiness by area", table: { head: ["Area", "Score", "Note"], rows: a.readiness.categories.map((c) => [c.label, c.score === null ? "Not enough evidence" : String(c.score), c.note]) } });
  const have = view.findings.filter((f) => f.section === "EXISTING");
  sections.push({ heading: "What they have", bullets: have.length ? have.map((f) => `${f.title} — ${f.observation}${usable(f) ? "" : "  [excluded by reviewer]"}`) : ["Nothing positive could be evidenced from the sources checked."] });
  const gaps = view.findings.filter((f) => f.section === "GAP");
  sections.push({ heading: "What they lack or we could not assess", table: { head: ["Finding", "State", "Confidence", "Priority", "Review", "Evidence"], rows: gaps.map((f) => [f.title, f.gapState ? STATE_LABEL[f.gapState] : "", CONFIDENCE_LABEL[f.confidence], f.priority ? PRIORITY_LABEL[f.priority] : "—", f.reviewStatus.toLowerCase() + (f.reviewNote ? ` — ${f.reviewNote}` : ""), f.evidenceUrls.slice(0, 3).join(" ")]) } });
  sections.push({ heading: "Recommended services", table: { head: ["Service", "Level", "Priority", "Approval", "Pricing basis", "Price override"], rows: view.recommendations.map((r) => [`${r.serviceName} (${r.serviceCode})`, LEVEL_LABEL[r.level], PRIORITY_LABEL[r.priority], r.approval.toLowerCase(), r.pricingEligibility, r.priceOverride ? `${formatInr(r.priceOverride.amountInr)} (${r.priceOverride.approvedBy})` : "—"]) } });
  if (a?.doNotPitch.length) sections.push({ heading: "Do not pitch", bullets: a.doNotPitch.map((d) => `${d.serviceName}: ${d.reason}`) });
  sections.push(pricingBlock(pricing, "INTERNAL"));
  const cov = view.job?.coverage;
  if (cov) sections.push({ heading: "Coverage and limits", bullets: [`${cov.pagesReviewed} pages retrieved; ${cov.officialSources} official and ${cov.thirdPartySources} third-party sources.`, ...cov.limitations] });
  return { title: `Internal report — ${view.ngo.name}`, subtitle: `Kreatif Atelier · generated ${day(generatedAt)} · INTERNAL: contains scores and review notes — do not share`, sections, footer: "Internal use only. Findings rest on public information and state how sure they are." };
}

const titleKey = (f: FindingView) => f.title.trim().toLowerCase();

/**
 * The audit records some points twice: once as a raw site check and once as a per-area finding that restates it.
 * A reader should see each point once, and a reviewer who rejects or excludes a point must not see it come back
 * through its restatement — so a hidden title hides every finding with that title.
 */
export function visibleForNgo(findings: FindingView[]): FindingView[] {
  const hidden = new Set(findings.filter((f) => !usable(f)).map(titleKey));
  const byTitle = new Map<string, FindingView>();
  for (const f of findings) {
    if (!usable(f) || hidden.has(titleKey(f))) continue;
    const prev = byTitle.get(titleKey(f));
    // keep the first position, but prefer the richer per-area wording
    if (!prev || (f.key.startsWith("area.") && !prev.key.startsWith("area."))) byTitle.set(titleKey(f), f);
  }
  return [...byTitle.values()];
}

export function ngoFacingReport(view: NgoView, pricing: PricingSection, generatedAt: string): DocModel {
  const name = view.identity?.officialName ?? view.ngo.name;
  const shown = visibleForNgo(view.findings);
  const good = shown.filter((f) => f.section === "EXISTING" && (f.assessment === "STRONG" || f.assessment === "ADEQUATE"));
  const gaps = shown.filter((f) => f.section === "GAP");
  const noted = gaps.filter((f) => f.gapState && f.gapState !== "UNABLE_TO_ASSESS");
  const unknown = gaps.filter((f) => f.gapState === "UNABLE_TO_ASSESS");
  const recs = view.recommendations.filter((r) => r.approval !== "REJECTED");
  const sentence = (f: FindingView) =>
    f.gapState === "CONFIRMED_ISSUE" ? `We observed: ${f.observation}`
    : f.gapState === "LIKELY_OPPORTUNITY" ? `This may be an opportunity: ${f.observation}`
    : `We did not find this in the public sources we checked (it may well exist elsewhere): ${f.observation}`;
  const sections: Section[] = [
    { heading: "About this review", paragraphs: [`This is a short, friendly look at ${name}'s public digital presence, prepared by Kreatif Atelier from information anyone can see on the web. It does not judge the quality of your work, and anything we could not see is marked as such rather than assumed.`] },
    { heading: "What is working well", bullets: good.length ? good.map((f) => `${f.title}. ${f.observation}`) : ["We would be glad to learn more about what you already do well — please tell us in a call."] },
    { heading: "Opportunities we noticed", bullets: noted.length ? noted.map((f) => `${f.title}. ${sentence(f)}`) : ["We did not find clear gaps in the public information we checked."] },
  ];
  if (unknown.length) sections.push({ heading: "What we could not assess", bullets: unknown.map((f) => f.title) });
  if (recs.length) sections.push({ heading: "How Kreatif Atelier could help", bullets: recs.map(recLine) });
  sections.push(pricingBlock(pricing, "NGO_FACING"));
  const pending = good.concat(noted).some((f) => f.reviewStatus === "PENDING") || recs.some((r) => r.approval === "PENDING");
  const doc: DocModel = {
    title: `Digital presence review — ${name}`, subtitle: `Prepared by Kreatif Atelier · ${day(generatedAt)} · based on publicly available information`,
    draftNotice: pending ? "DRAFT — some points have not yet been approved by the Kreatif Atelier team. Please review before sharing." : undefined,
    sections, footer: "Kreatif Atelier · This review uses public information only and may not reflect work you do offline.",
  };
  assertSafe(doc);
  return doc;
}

export function proposalDoc(view: NgoView, pricing: PricingSection, generatedAt: string): DocModel {
  const pitch = view.pitches[0];
  const draft = pitch?.drafts.find((d) => d.channel === "ONE_PAGE_PROPOSAL");
  if (!draft) throw new ExportBlocked("There is no proposal draft yet. Open the audit and generate the pitch first.");
  if (draft.status === "REJECTED") throw new ExportBlocked("The proposal draft was rejected. Regenerate or edit and approve it first.");
  const body = (draft.editedBody ?? draft.body).trim();
  const name = view.identity?.officialName ?? view.ngo.name;
  const doc: DocModel = {
    title: `Proposal for ${name}`, subtitle: `Kreatif Atelier · ${day(generatedAt)}`,
    draftNotice: draft.status === "APPROVED" ? undefined : "DRAFT — this proposal has not yet been approved by the Kreatif Atelier team.",
    sections: [{ heading: "Overview", paragraphs: body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) }, pricingBlock(pricing, "NGO_FACING")],
    footer: "Kreatif Atelier · Based on publicly available information. Nothing here is a commitment until agreed in writing.",
  };
  assertSafe(doc);
  return doc;
}

function assertSafe(doc: DocModel) {
  try { assertClientSafe(doc); } catch (e) { throw new ExportBlocked(`This document was blocked because it mentions internal information (${e instanceof Error ? e.message : "client-safety check"}). Edit the source text and try again.`, 422); }
}

export async function modelToPdf(doc: DocModel): Promise<Buffer> {
  const { Document, Page, Text, View, StyleSheet, renderToBuffer } = await import("@react-pdf/renderer");
  const h = React.createElement;
  const st = StyleSheet.create({
    page: { padding: 40, paddingBottom: 54, fontSize: 10, color: "#111210", fontFamily: "Helvetica", lineHeight: 1.45 },
    title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 3 },
    sub: { fontSize: 9, color: "#5b5a54", marginBottom: 10 },
    notice: { backgroundColor: "#f3ead3", padding: 6, marginBottom: 10, fontSize: 9 },
    h: { fontSize: 12.5, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4, color: "#111210", borderBottomWidth: 1, borderBottomColor: "#cdb98a", paddingBottom: 2 },
    p: { marginBottom: 5 },
    li: { flexDirection: "row", marginBottom: 3 },
    dot: { width: 10 },
    tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#d6d1c3" },
    th: { backgroundColor: "#111210", color: "#f3f0e9", fontFamily: "Helvetica-Bold" },
    foot: { position: "absolute", bottom: 22, left: 40, right: 40, fontSize: 8, color: "#5b5a54", textAlign: "center" },
  });
  const tableEl = (t: NonNullable<Section["table"]>) => {
    const w = `${100 / t.head.length}%`;
    return h(View, { style: { marginTop: 2 } },
      h(View, { style: [st.tr, st.th], wrap: false }, ...t.head.map((c, i) => h(Text, { key: i, style: { width: w, padding: 3, fontSize: 8.5 } }, c))),
      ...t.rows.map((r, ri) => h(View, { key: ri, style: st.tr, wrap: false }, ...r.map((c, i) => h(Text, { key: i, style: { width: w, padding: 3, fontSize: 8.5 } }, c)))));
  };
  const el = h(Document, { title: doc.title, author: "Kreatif Atelier" },
    h(Page, { size: "A4", style: st.page },
      h(Text, { style: st.title }, doc.title), h(Text, { style: st.sub }, doc.subtitle),
      doc.draftNotice ? h(Text, { style: st.notice }, doc.draftNotice) : null,
      ...doc.sections.map((s, i) => h(View, { key: i },
        h(Text, { style: st.h, minPresenceAhead: 40 }, s.heading),
        ...(s.paragraphs ?? []).map((p, j) => h(Text, { key: `p${j}`, style: st.p }, p)),
        ...(s.bullets ?? []).map((b, j) => h(View, { key: `b${j}`, style: st.li, wrap: false }, h(Text, { style: st.dot }, "•"), h(Text, { style: { flex: 1 } }, b))),
        s.table ? tableEl(s.table) : null)),
      h(Text, { style: st.foot, fixed: true, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `${doc.footer}  ·  ${pageNumber}/${totalPages}` })));
  return Buffer.from(await renderToBuffer(el));
}

export function evidenceCsv(view: NgoView): string {
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ["URL", "Title", "Type", "Official", "Fetch status", "HTTP", "Confidence", "Checked", "Summary", "Failure reason"];
  const lines = [head.join(",")];
  for (const e of view.evidence) lines.push([e.url, e.title ?? "", SOURCE_LABEL[e.sourceType], e.isOfficial ? "Yes" : "No", e.fetchStatus, e.httpStatus ?? "", e.confidence, e.checkedAt, e.summary ?? "", e.failureReason ?? ""].map((v) => esc(csvSafe(v as string | number))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export async function internalXlsx(view: NgoView, pricing: PricingSection, generatedAt: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kreatif Atelier";
  const sheet = (name: string, head: string[], rows: (string | number | null)[][], widths: number[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    const hr = ws.addRow(head);
    hr.font = { bold: true, color: { argb: "FFF3F0E9" } };
    hr.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111210" } }; });
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    for (const r of rows) ws.addRow(r.map((v) => (typeof v === "string" ? csvSafe(v) : v))).alignment = { vertical: "top", wrapText: true };
    return ws;
  };
  const a = view.analysis;
  sheet("Summary", ["Item", "Value"], [
    ["NGO", view.ngo.name], ["Location", view.ngo.location], ["Website", view.identity?.officialWebsite ?? "Not found publicly"],
    ["Digital readiness", a?.readiness.overall ?? "Not enough evidence"], ["Prospect priority (internal)", a?.opportunity?.total ?? null],
    ["Contact status", CONTACT_LABEL[view.ngo.contactStatus]], ["Interest", INTEREST_LABEL[view.ngo.interestStatus]], ["Generated", day(generatedAt)], ["Marking", "INTERNAL — do not share with the NGO"],
  ], [30, 70]);
  sheet("Findings", ["Section", "Finding", "State", "Confidence", "Priority", "Review", "Observation", "Why it matters", "Evidence"],
    view.findings.map((f) => [f.section, f.title, f.gapState ? STATE_LABEL[f.gapState] : f.assessment, CONFIDENCE_LABEL[f.confidence], f.priority ? PRIORITY_LABEL[f.priority] : "", f.reviewStatus, f.observation, f.whyItMatters ?? "", f.evidenceUrls.join("\n")]), [10, 34, 18, 16, 14, 12, 60, 40, 50]);
  sheet("Recommendations", ["Code", "Service", "Level", "Priority", "Approval", "Pricing basis", "Price override (INR)", "Deliverables", "Expected outcome"],
    view.recommendations.map((r) => [r.serviceCode, r.serviceName, LEVEL_LABEL[r.level], PRIORITY_LABEL[r.priority], r.approval, r.pricingEligibility, r.priceOverride?.amountInr ?? null, r.proposedDeliverables, r.expectedOutcome]), [10, 36, 18, 14, 12, 22, 16, 60, 40]);
  sheet("Evidence", ["URL", "Title", "Type", "Official", "Fetch status", "Confidence", "Checked"],
    view.evidence.map((e) => [e.url, e.title ?? "", SOURCE_LABEL[e.sourceType], e.isOfficial ? "Yes" : "No", e.fetchStatus, e.confidence, e.checkedAt]), [60, 40, 18, 9, 22, 12, 24]);
  sheet("Pricing", ["Item"], pricingBlock(pricing, "INTERNAL").bullets?.map((b) => [b]) ?? [], [110]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
