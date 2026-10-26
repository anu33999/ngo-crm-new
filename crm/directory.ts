import darpan from "@/data/directory.hyderabad-secunderabad.json";
import imported from "@/data/directory.asraya-hyderabad-secunderabad.json";
import { withApproxGeo } from "@/lib/geo/areas";
import type { DirectoryEntry } from "./types";

/**
 * Bundled directory for the Hyderabad / Secunderabad twin cities (server only — never import this from a client component).
 *  1. 28 organisations read from public NGO Darpan listing pages (name, registration number, address, sectors).
 *  2. 248 organisations from the team's own spreadsheet (reference/Asraya_HYD_NGO_list.xlsx), with contact details as listed there.
 * Coordinates are neighbourhood/city approximations labelled as such — never exact addresses.
 */
export function starterEntries(): DirectoryEntry[] {
  return [...(darpan.entries as unknown as DirectoryEntry[]), ...(imported.entries as unknown as DirectoryEntry[])].map(withApproxGeo);
}
