import { actorOf, handle, HttpError, json, rateLimit } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { parseCsv, parseNgoRows, readXlsxRows } from "@/lib/import/ngo-sheet";
import { normalizeName } from "@/lib/research/text";
import { tidyPlace } from "@/lib/geo/areas";

export const maxDuration = 120;
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/directory/import   (multipart/form-data: file, defaultCity?, preview?)
 * Reads an NGO list from .xlsx or .csv. With preview=1 nothing is written and the response says what WOULD happen.
 * Without it, new NGOs are added, and NGOs already present (same name + city) only have their EMPTY fields filled —
 * nothing a person typed is overwritten, and contact status of existing NGOs is never changed.
 */
export async function POST(req: Request) {
  return handle(async () => {
    rateLimit(`import:${actorOf(req)}`, 30, 60 * 60 * 1000);
    if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) throw new HttpError(400, "Upload the file as form data.");
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 1024 * 1024) throw new HttpError(413, "That file is larger than 5 MB.");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Choose a .xlsx or .csv file to import.");
    if (file.size === 0) throw new HttpError(400, "That file is empty.");
    if (file.size > MAX_BYTES) throw new HttpError(413, "That file is larger than 5 MB.");
    const lower = file.name.toLowerCase();
    const isCsv = lower.endsWith(".csv") || file.type === "text/csv";
    const isXlsx = lower.endsWith(".xlsx");
    if (!isCsv && !isXlsx) throw new HttpError(400, "Only .xlsx and .csv files can be imported. (Save older .xls files as .xlsx first.)");
    const defaultCity = typeof form.get("defaultCity") === "string" ? tidyPlace(String(form.get("defaultCity")).slice(0, 80)) ?? undefined : undefined;
    const preview = form.get("preview") === "1";

    let sheet = "CSV";
    let rows: unknown[][];
    try {
      const buf = await file.arrayBuffer();
      if (isCsv) rows = parseCsv(new TextDecoder("utf-8").decode(buf));
      else ({ sheet, rows } = await readXlsxRows(buf));
    } catch {
      throw new HttpError(400, "That file could not be read. Check that it is a valid .xlsx or .csv file.");
    }
    const parsed = parseNgoRows(rows, { defaultCity });
    if (parsed.headerRow === null) throw new HttpError(422, parsed.warnings[0]);
    if (parsed.entries.length === 0) throw new HttpError(422, "No NGO rows were found under the header.");

    const { store } = getDeps();
    const base = {
      sheet, headerRow: parsed.headerRow, rowsRead: parsed.entries.length + parsed.skipped.length,
      columns: parsed.columns, unusedColumns: parsed.unusedHeaders, warnings: parsed.warnings, skipped: parsed.skipped.slice(0, 50), skippedCount: parsed.skipped.length,
    };
    if (preview) {
      const have = new Set((await store.listRecords({})).map((r) => `${normalizeName(r.name)}|${(r.city ?? "").toLowerCase()}`));
      const fresh = parsed.entries.filter((e) => !have.has(`${normalizeName(e.name)}|${e.city.toLowerCase()}`));
      return json({ ...base, preview: true, willAdd: fresh.length, alreadyPresent: parsed.entries.length - fresh.length, sample: parsed.entries.slice(0, 5).map((e) => ({ name: e.name, city: e.city, phone: e.phone ?? null, website: e.website ?? null })) });
    }
    const out = await store.upsertEntries(parsed.entries, actorOf(req), { fillBlanks: true });
    return json({ ...base, preview: false, added: out.created.length, alreadyPresent: out.existing.length, filled: out.updated.length });
  });
}
