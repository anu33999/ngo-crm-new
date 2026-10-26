import { after } from "next/server";
import { handle, json, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { selectCandidate } from "@/lib/research/runner";

export const maxDuration = 300;

/** Resolve an ambiguous identity: pick a listed candidate, or supply the official website. */
export async function POST(req: Request, ctx: RouteContext<"/api/research/[id]/select">) {
  return handle(async () => {
    const body = await readJson<{ key?: unknown; website?: unknown }>(req);
    const choice = { key: typeof body.key === "string" ? body.key : undefined, website: typeof body.website === "string" ? body.website.slice(0, 500) : undefined };
    return json(await selectCandidate(getDeps(), (await ctx.params).id, choice, (p) => after(() => p)), 202);
  });
}
