import { handle, json } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { cancelJob } from "@/lib/research/runner";

export async function POST(_req: Request, ctx: RouteContext<"/api/research/[id]/cancel">) {
  return handle(async () => json(await cancelJob(getDeps(), (await ctx.params).id)));
}
