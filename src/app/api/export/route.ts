import { actorOf, handle, HttpError } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { parseFilter } from "@/lib/server/ngo-input";
import { toCsv, toPdf, toXlsx } from "@/lib/export/crm";

export const maxDuration = 60;

const TYPES = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

/**
 * GET /api/export?format=csv|xlsx|pdf&scope=crm|all  (+ any /api/ngos filter, e.g. city=Hyderabad&status=CONTACTED)
 * Internal CRM export. Defaults to the CRM list ("My NGOs").
 */
export async function GET(req: Request) {
  return handle(async () => {
    const sp = new URL(req.url).searchParams;
    const format = (sp.get("format") ?? "csv") as keyof typeof TYPES;
    if (!(format in TYPES)) throw new HttpError(400, "format must be csv, xlsx or pdf.");
    const filter = parseFilter(sp);
    if (sp.get("scope") !== "all" && filter.inCrm === undefined) filter.inCrm = true;
    const records = await getDeps().store.listRecords(filter);
    const now = new Date().toISOString();
    const body = format === "csv" ? toCsv(records) : format === "xlsx" ? await toXlsx(records, now) : await toPdf(records, now);
    const name = `kreatif-crm-internal-${now.slice(0, 10)}.${format}`;
    void actorOf(req);
    return new Response(body as BodyInit, { headers: { "content-type": TYPES[format], "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
  });
}
