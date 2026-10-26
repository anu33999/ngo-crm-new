import ExcelJS from "exceljs";
import React from "react";
import { categoriesOf, CONTACT_LABEL, INTEREST_LABEL, WEBSITE_LABEL, DARPAN_LABEL, type NgoRecord } from "@/lib/crm/types";

/**
 * Internal CRM exports (CSV / Excel / PDF). These carry readiness and opportunity scores and are for the
 * Kreatif Atelier team only — NGO-facing documents are produced separately and never include them.
 */

export const CRM_COLUMNS: { key: string; header: string; get: (r: NgoRecord) => string | number | boolean | null; width: number }[] = [
  { key: "name", header: "NGO", get: (r) => r.name, width: 38 },
  { key: "city", header: "City", get: (r) => r.city, width: 14 },
  { key: "area", header: "Area", get: (r) => r.area, width: 20 },
  { key: "category", header: "Category", get: (r) => categoriesOf(r).join(", ") || null, width: 26 },
  { key: "cause", header: "Cause / sectors (as listed)", get: (r) => r.cause, width: 34 },
  { key: "address", header: "Address", get: (r) => r.address, width: 44 },
  { key: "orgType", header: "Organisation type", get: (r) => r.organisationType, width: 24 },
  { key: "contactPerson", header: "Contact person", get: (r) => r.contactPerson, width: 22 },
  { key: "designation", header: "Designation", get: (r) => r.designation, width: 18 },
  { key: "phone", header: "Phone", get: (r) => r.phone, width: 18 },
  { key: "email", header: "Email", get: (r) => r.email, width: 26 },
  { key: "instagram", header: "Instagram", get: (r) => r.instagram, width: 22 },
  { key: "website", header: "Website", get: (r) => r.website ?? "Not found publicly", width: 30 },
  { key: "websiteStatus", header: "Website status", get: (r) => WEBSITE_LABEL[r.websiteStatus], width: 24 },
  { key: "darpan", header: "NGO Darpan", get: (r) => DARPAN_LABEL[r.darpanStatus], width: 30 },
  { key: "regNo", header: "Registration no. (as listed)", get: (r) => r.darpanId, width: 24 },
  { key: "contact", header: "Contact status", get: (r) => CONTACT_LABEL[r.contactStatus], width: 18 },
  { key: "interest", header: "Interest", get: (r) => INTEREST_LABEL[r.interestStatus], width: 16 },
  { key: "inCrm", header: "In CRM", get: (r) => (r.inCrm ? "Yes" : "No"), width: 8 },
  { key: "priority", header: "Priority", get: (r) => r.priority, width: 10 },
  { key: "contactedAt", header: "Last contacted", get: (r) => (r.contactedAt ? r.contactedAt.slice(0, 10) : null), width: 13 },
  { key: "nextAction", header: "Next action", get: (r) => r.nextAction, width: 40 },
  { key: "meeting", header: "Meeting scheduled", get: (r) => (r.meetingScheduled ? "Yes" : "No"), width: 10 },
  { key: "meetingAt", header: "Meeting time", get: (r) => (r.meetingAt ? r.meetingAt.slice(0, 16).replace("T", " ") : null), width: 17 },
  { key: "followUp", header: "Follow-up on", get: (r) => (r.followUpAt ? r.followUpAt.slice(0, 10) : null), width: 13 },
  { key: "notes", header: "Notes", get: (r) => r.notes, width: 40 },
  { key: "whatTheyDo", header: "What they do", get: (r) => r.whatTheyDo, width: 40 },
  { key: "beneficiaries", header: "Who they serve", get: (r) => r.beneficiaries, width: 28 },
  { key: "canHelpWith", header: "How we can help", get: (r) => r.canHelpWith, width: 40 },
  { key: "potentialProject", header: "Potential project", get: (r) => r.potentialProject, width: 34 },
  { key: "partnershipValue", header: "Partnership value", get: (r) => r.partnershipValue, width: 12 },
  { key: "pitch", header: "Pitch summary", get: (r) => r.pitchSummary?.replace(/\n/g, " ") ?? null, width: 50 },
  { key: "services", header: "Matched service codes", get: (r) => r.matchedServiceCodes.join(", "), width: 24 },
  { key: "readiness", header: "Digital readiness (internal)", get: (r) => r.readinessScore, width: 16 },
  { key: "opportunity", header: "Opportunity score (internal)", get: (r) => r.opportunityScore, width: 16 },
  { key: "audited", header: "Last audited", get: (r) => (r.lastResearchedAt ? r.lastResearchedAt.slice(0, 10) : "Not audited"), width: 14 },
  { key: "source", header: "Source", get: (r) => r.sourceNote ?? r.source, width: 40 },
];

/** Spreadsheet apps run text starting with = + - @ as formulas. Prefix an apostrophe-free guard: a leading single quote. */
export function csvSafe(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d.,\s]*$/.test(s)) s = `'${s}`;
  return s;
}

export function toCsv(records: NgoRecord[]): string {
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [CRM_COLUMNS.map((c) => esc(c.header)).join(",")];
  for (const r of records) lines.push(CRM_COLUMNS.map((c) => esc(csvSafe(c.get(r)))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export async function toXlsx(records: NgoRecord[], generatedAt: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kreatif Atelier";
  const ws = wb.addWorksheet("Outreach CRM", { views: [{ state: "frozen", ySplit: 3, xSplit: 1 }] });
  ws.addRow([`Kreatif Atelier — Outreach CRM (internal; contains scores — do not share with NGOs). Generated ${generatedAt.slice(0, 10)}.`]);
  ws.mergeCells(1, 1, 1, 8);
  ws.getRow(1).font = { bold: true, color: { argb: "FF111210" } };
  ws.addRow([]);
  const head = ws.addRow(CRM_COLUMNS.map((c) => c.header));
  head.font = { bold: true, color: { argb: "FFF3F0E9" } };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111210" } }; c.alignment = { vertical: "middle", wrapText: true }; });
  CRM_COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
  for (const r of records) {
    // Cells are written as typed strings/numbers (never as formulas), with the same leading-character guard as CSV.
    const row = ws.addRow(CRM_COLUMNS.map((c) => { const v = c.get(r); return typeof v === "string" ? csvSafe(v) : v; }));
    row.alignment = { vertical: "top", wrapText: true };
    const contact = row.getCell(CRM_COLUMNS.findIndex((c) => c.key === "contact") + 1);
    const colour = r.contactStatus === "CONTACTED" ? "FFD1FAE5" : r.contactStatus === "FOLLOW_UP_SCHEDULED" ? "FFDBEAFE" : "FFFEF3C7";
    contact.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colour } };
  }
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: CRM_COLUMNS.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function toPdf(records: NgoRecord[], generatedAt: string): Promise<Buffer> {
  const { Document, Page, Text, View, StyleSheet, renderToBuffer } = await import("@react-pdf/renderer");
  const h = React.createElement;
  const cols: { header: string; w: string; get: (r: NgoRecord) => string }[] = [
    { header: "NGO", w: "26%", get: (r) => r.name },
    { header: "Location", w: "16%", get: (r) => r.location ?? "" },
    { header: "Phone", w: "12%", get: (r) => r.phone ?? "—" },
    { header: "Website", w: "18%", get: (r) => r.website?.replace(/^https?:\/\//, "") ?? "Not found publicly" },
    { header: "Contact", w: "12%", get: (r) => CONTACT_LABEL[r.contactStatus] },
    { header: "Interest", w: "10%", get: (r) => INTEREST_LABEL[r.interestStatus] },
    { header: "Notes", w: "6%", get: (r) => (r.notes ? "Yes" : "") },
  ];
  const st = StyleSheet.create({
    page: { padding: 28, fontSize: 8, color: "#111210", fontFamily: "Helvetica" },
    title: { fontSize: 15, marginBottom: 2, fontFamily: "Helvetica-Bold" },
    sub: { fontSize: 8, color: "#555", marginBottom: 10 },
    row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#d9d4c5", paddingVertical: 3 },
    head: { flexDirection: "row", backgroundColor: "#111210", color: "#F3F0E9", paddingVertical: 4 },
    cell: { paddingHorizontal: 3 },
  });
  const doc = h(Document, { title: "Kreatif Atelier — Outreach CRM", author: "Kreatif Atelier" },
    h(Page, { size: "A4", orientation: "landscape", style: st.page },
      h(Text, { style: st.title }, "Kreatif Atelier — Outreach CRM"),
      h(Text, { style: st.sub }, `Internal working list · ${records.length} NGO(s) · generated ${generatedAt.slice(0, 10)} · not for sharing with NGOs`),
      h(View, { style: st.head }, ...cols.map((c) => h(Text, { key: c.header, style: [st.cell, { width: c.w }] }, c.header))),
      ...records.map((r) => h(View, { key: r.id, style: st.row, wrap: false }, ...cols.map((c) => h(Text, { key: c.header, style: [st.cell, { width: c.w }] }, c.get(r)))))));
  return Buffer.from(await renderToBuffer(doc));
}
