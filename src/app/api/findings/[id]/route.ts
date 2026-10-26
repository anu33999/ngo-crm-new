import { actorOf, handle, HttpError, json, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";

const STATUS = ["PENDING", "APPROVED", "REJECTED", "EXCLUDED"] as const;

/** Review a finding: approve, reject, or exclude it (excluded findings never reach NGO-facing output). */
export async function PATCH(req: Request, ctx: RouteContext<"/api/findings/[id]">) {
  return handle(async () => {
    const b = await readJson<{ reviewStatus?: unknown; reviewNote?: unknown }>(req);
    if (!STATUS.includes(b.reviewStatus as (typeof STATUS)[number])) throw new HttpError(400, "Unknown review status.");
    if (b.reviewNote !== undefined && (typeof b.reviewNote !== "string" || b.reviewNote.length > 2000)) throw new HttpError(400, "Note must be text of up to 2000 characters.");
    await getDeps().store.reviewFinding((await ctx.params).id, { reviewStatus: b.reviewStatus as (typeof STATUS)[number], reviewNote: b.reviewNote as string | undefined }, actorOf(req));
    return json({ ok: true });
  });
}
