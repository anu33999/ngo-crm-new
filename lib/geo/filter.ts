import type { NgoRecord } from "@/lib/crm/types";

export type MapFilter = "all" | "reached" | "not-reached";

/** "Reached" = any contacted state (Contacted or Follow-up scheduled). */
export function isReached(r: Pick<NgoRecord, "contactStatus">) { return r.contactStatus !== "NOT_CONTACTED"; }

export function applyMapFilter<T extends Pick<NgoRecord, "contactStatus">>(rs: T[], f: MapFilter): T[] {
  return f === "reached" ? rs.filter(isReached) : f === "not-reached" ? rs.filter((r) => !isReached(r)) : rs;
}
