"use client";

import * as React from "react";
import { PRIORITIES, type NgoPatch, type NgoRecord, type ProfileKey } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { useNgoData } from "./ngo-data";
import { ContactSelect, InterestSelect, MeetingCell } from "./parts";
import { NotesPanel } from "./notes-panel";

const fieldCls = "w-full rounded-md border border-input bg-card px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type TextKey = "phone" | "email" | "website" | "address" | "cause" | ProfileKey;

/** A text field that saves when you click away (or press Enter in a one-line field). Shows what is stored until you start typing. */
function Field({ record, field, label, hint, rows, type = "text", placeholder }: {
  record: NgoRecord; field: TextKey; label: string; hint?: string; rows?: number; type?: string; placeholder?: string;
}) {
  const { patch, toast } = useNgoData();
  const stored = (record[field] as string | null) ?? "";
  const [draft, setDraft] = React.useState<string | null>(null);
  const id = `f-${field}-${record.id}`;
  const value = draft ?? stored;

  async function commit() {
    const next = (draft ?? stored).trim();
    setDraft(null);
    if (next === stored) return;
    if (field === "website" && next && (/\s/.test(next) || !next.includes("."))) { toast("That website address does not look valid.", "error"); return; }
    await patch(record.id, { [field]: next || null } as NgoPatch);
  }
  const common = {
    id, value, placeholder, onFocus: () => setDraft(stored), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value), onBlur: commit,
    "aria-label": `${record.name}: ${label.toLowerCase()}`,
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">{label}{hint && <span className="ml-1 font-normal text-muted-foreground">{hint}</span>}</label>
      {rows
        ? <textarea {...common} rows={rows} className={cn(fieldCls, "py-1.5")} />
        : <input {...common} type={type} className={cn(fieldCls, "h-8")} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(null); e.currentTarget.blur(); } }} />}
    </div>
  );
}

/**
 * Everything about one NGO in one place, all editable: contact details, pipeline state, profile text, notes and activity.
 * Used by both Discovery and the Outreach CRM, and writes through the shared store so every view stays in step.
 */
export function DetailsPanel({ record }: { record: NgoRecord }) {
  const { patch } = useNgoData();
  const lastContacted = record.contactedAt ? record.contactedAt.slice(0, 10) : "";
  return (
    <div>
      <div className="grid gap-5 p-4 md:grid-cols-2 xl:grid-cols-3">
        <section aria-label="Contact details" className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact</h3>
          <Field record={record} field="phone" label="Phone" hint="(separate several with /)" type="tel" placeholder="+91 …" />
          <Field record={record} field="email" label="Email" type="text" placeholder="name@example.org" />
          <Field record={record} field="website" label="Website" type="text" placeholder="example.org" />
          <Field record={record} field="instagram" label="Instagram" placeholder="@handle or link" />
          <Field record={record} field="contactPerson" label="Contact person" />
          <Field record={record} field="designation" label="Designation" />
          <Field record={record} field="address" label="Address" rows={2} />
        </section>

        <section aria-label="Outreach status" className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outreach</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><span className="mb-1 block text-xs font-medium">Contacted?</span><ContactSelect record={record} /></div>
            <div><span className="mb-1 block text-xs font-medium">Interest</span><InterestSelect record={record} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`prio-${record.id}`} className="mb-1 block text-xs font-medium">Priority</label>
              <select id={`prio-${record.id}`} value={record.priority ?? ""} onChange={(e) => void patch(record.id, { priority: e.target.value || null })} className={cn(fieldCls, "h-8")} aria-label={`${record.name}: priority`}>
                <option value="">Not set</option>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`lc-${record.id}`} className="mb-1 block text-xs font-medium">Last contacted</label>
              <input id={`lc-${record.id}`} type="date" value={lastContacted} max={new Date().toISOString().slice(0, 10)} aria-label={`${record.name}: last contacted`}
                onChange={(e) => void patch(record.id, { contactedAt: e.target.value ? new Date(`${e.target.value}T09:00:00`).toISOString() : null })} className={cn(fieldCls, "h-8")} />
            </div>
          </div>
          <div><span className="mb-1 block text-xs font-medium">Meeting</span><MeetingCell record={record} stacked={false} /></div>
          <Field record={record} field="nextAction" label="Next action" rows={3} placeholder="e.g. Call the programme head on Monday" />
          <Field record={record} field="potentialProject" label="Potential project" rows={2} />
        </section>

        <section aria-label="Organisation profile" className="space-y-3 md:col-span-2 xl:col-span-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">About the NGO</h3>
          <Field record={record} field="cause" label="Category / cause" hint="(e.g. Animals, Elderly, Children)" />
          <Field record={record} field="organisationType" label="Organisation type" />
          <Field record={record} field="whatTheyDo" label="What they do" rows={2} />
          <Field record={record} field="beneficiaries" label="Who they serve" rows={2} />
          <Field record={record} field="currentProjects" label="Current projects" rows={2} />
          <Field record={record} field="mainNeed" label="Main need" rows={2} />
          <Field record={record} field="canHelpWith" label="How we can help" rows={3} />
          <Field record={record} field="partnershipValue" label="Partnership value" />
        </section>
      </div>
      {record.sourceNote && (
        <p className="border-t border-dashed border-border px-4 py-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Where this entry came from:</span> {record.sourceNote}</p>
      )}
      <div className="border-t border-dashed border-border"><NotesPanel record={record} /></div>
    </div>
  );
}
