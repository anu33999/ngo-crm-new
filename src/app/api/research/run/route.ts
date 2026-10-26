import { after } from "next/server";
import { actorOf, handle, HttpError, json, rateLimit, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { startBatch, startResearch } from "@/lib/research/runner";

export const maxDuration = 300;

/**
 * POST /api/research/run
 *   { ngoId }                 audit one directory/CRM record (reuses the saved audit unless refresh)
 *   { ngoIds: [...] }         audit several, two at a time
 *   { name, location? }       research a new name
 * Returns immediately; work continues in the background and progress is read from /api/research/[jobId].
 */
export async function POST(req: Request) {
  return handle(async () => {
    const b = await readJson<{ ngoId?: unknown; ngoIds?: unknown; name?: unknown; location?: unknown; refresh?: unknown }>(req);
    const refresh = b.refresh === true;
    const keep = (p: Promise<unknown>) => after(() => p);
    const deps = getDeps();
    if (Array.isArray(b.ngoIds)) {
      const ids = b.ngoIds.filter((i): i is string => typeof i === "string");
      if (!ids.length || ids.length > 25) throw new HttpError(400, "Select between 1 and 25 NGOs to audit at once.");
      rateLimit(`research-batch:${actorOf(req)}`, 60, 60 * 60 * 1000);
      return json(await startBatch(deps, ids, { refresh }, keep), 202);
    }
    rateLimit(`research:${actorOf(req)}`, 30, 60 * 60 * 1000);
    const out = await startResearch(deps, { name: b.name, location: b.location, ngoId: typeof b.ngoId === "string" ? b.ngoId : undefined, refresh }, keep);
    return json(out, out.cached ? 200 : 202);
  });
}
