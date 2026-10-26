import { after } from "next/server";
import { actorOf, handle, json, rateLimit, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { startResearch } from "@/lib/research/runner";

export const maxDuration = 300;

/** Start (or reuse) a research job. Returns immediately; the job runs in the background. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{ name?: unknown; location?: unknown; refresh?: unknown }>(req);
    rateLimit(`research:${actorOf(req)}`, 30, 60 * 60 * 1000);
    const out = await startResearch(getDeps(), { name: body.name, location: body.location, refresh: body.refresh === true }, (p) => after(() => p));
    return json(out, out.cached ? 200 : 202);
  });
}

/** Recent jobs and researched NGOs, for the home screen. */
export async function GET() {
  return handle(async () => {
    const { store } = getDeps();
    const [jobs, ngos] = await Promise.all([store.listJobs(15), store.listRecords({ audited: true })]);
    return json({ jobs, ngos: ngos.slice(0, 50) });
  });
}
