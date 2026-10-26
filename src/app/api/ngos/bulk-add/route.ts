import { actorOf, handle, json, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { parseIds } from "@/lib/server/ngo-input";

/** POST /api/ngos/bulk-add { ids } — add the selected NGOs to the Outreach CRM. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    const records = await getDeps().store.bulkUpdate(parseIds(b), { inCrm: true }, actorOf(req));
    return json({ records });
  });
}
