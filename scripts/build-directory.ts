/**
 * Rebuilds src/data/directory.asraya-hyderabad-secunderabad.json from reference/Asraya_HYD_NGO_list.xlsx.
 * Run: npx tsx scripts/build-directory.ts   (the JSON is committed, so seeding itself does not need this)
 * Uses the same parser as the in-app "Import spreadsheet" button, so what you see there is what is bundled here.
 */
import fs from "node:fs";
import path from "node:path";
import { parseNgoRows, readXlsxRows } from "../src/lib/import/ngo-sheet";

async function main() {
  const src = path.join(__dirname, "..", "reference", "Asraya_HYD_NGO_list.xlsx");
  const { sheet, rows } = await readXlsxRows(fs.readFileSync(src));
  const parsed = parseNgoRows(rows);
  if (parsed.skipped.length) console.warn("Skipped rows:", parsed.skipped);
  for (const w of parsed.warnings) console.warn("Warning:", w);
  // Coordinates are derived at load time (area / city centre), so they are not stored in the file.
  const entries = parsed.entries.map(({ latitude, longitude, geoBasis, ...rest }) => { void latitude; void longitude; void geoBasis; return rest; });
  const out = {
    _comment: "Imported from reference/Asraya_HYD_NGO_list.xlsx (sheet “" + sheet + "”). Contact details are public-source data per that workbook's own Guide sheet and should be verified before outreach; blank fields were not verified. Regenerate with `npx tsx scripts/build-directory.ts`.",
    entries,
  };
  const dest = path.join(__dirname, "..", "src", "data", "directory.asraya-hyderabad-secunderabad.json");
  fs.writeFileSync(dest, JSON.stringify(out, null, 1) + "\n");
  const by = (f: (e: (typeof entries)[number]) => string | null | undefined) => entries.reduce<Record<string, number>>((m, e) => { const k = f(e) ?? "—"; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  console.log(`Wrote ${entries.length} entries to ${path.relative(process.cwd(), dest)}`);
  console.log("by city", by((e) => e.city), "| priority", by((e) => e.priority), "| status", by((e) => e.contactStatus));
  console.log("with phone", entries.filter((e) => e.phone).length, "| website", entries.filter((e) => e.website).length, "| email", entries.filter((e) => e.email).length, "| contact person", entries.filter((e) => e.contactPerson).length, "| area matched", entries.filter((e) => e.area).length, "| address", entries.filter((e) => e.address).length);
}
main().catch((e) => { console.error(e); process.exit(1); });
