import { handle, HttpError, json } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { reapIfStale } from "@/lib/research/runner";

export async function GET(_req: Request, ctx: RouteContext<"/api/research/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const deps = getDeps();
    const job = await deps.store.getJob(id);
    if (!job) throw new HttpError(404, "Job not found.");
    return json(await reapIfStale(deps, job));
  });
}
