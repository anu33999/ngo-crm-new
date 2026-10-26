import { actorOf, handle, HttpError, json, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { parseIds, parsePatch } from "@/lib/server/ngo-input";

/** POST /api/ngos/bulk-update { ids, patch } — e.g. mark the selected NGOs as contacted. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    const patch = parsePatch((b.patch ?? {}) as Record<string, unknown>);
    if (Object.keys(patch).length === 0) throw new HttpError(400, "Nothing to update.");
    const records = await getDeps().store.bulkUpdate(parseIds(b), patch, actorOf(req));
    return json({ records });
  });
}
