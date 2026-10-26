import { after } from "next/server";
import { handle, json } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { retryJob } from "@/lib/research/runner";

export const maxDuration = 300;

export async function POST(_req: Request, ctx: RouteContext<"/api/research/[id]/retry">) {
  return handle(async () => json(await retryJob(getDeps(), (await ctx.params).id, (p) => after(() => p)), 202));
}
