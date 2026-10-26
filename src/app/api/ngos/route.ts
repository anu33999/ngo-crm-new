import { actorOf, handle, json, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { facetsOf } from "@/lib/crm/types";
import { ensureDirectory } from "@/lib/server/directory";
import { parseEntry, parseFilter } from "@/lib/server/ngo-input";

/** GET /api/ngos?city=&status=&search=&area=&cause=&interest=&darpan=&inCrm=&audited= — filtered records plus filter options from the database. */
export async function GET(req: Request) {
  return handle(async () => {
    const { store } = getDeps();
    await ensureDirectory(store);
    const filter = parseFilter(new URL(req.url).searchParams);
    const [records, all] = await Promise.all([store.listRecords(filter), store.listRecords({})]);
    return json({ records, facets: facetsOf(all), total: all.length });
  });
}

/** Add one NGO by hand (or confirm a search-discovered one). Duplicate name + city is reported, not created twice. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    const source = b.source === "DISCOVERED" ? "DISCOVERED" : "MANUAL";
    const entry = parseEntry(b, source);
    const { created, existing } = await getDeps().store.upsertEntries([entry], actorOf(req));
    return json({ record: created[0] ?? existing[0], created: created.length === 1 }, created.length ? 201 : 200);
  });
}
