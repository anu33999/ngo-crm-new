import { actorOf, handle, HttpError, json, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";

/** Toggle a recommendation on/off, or set/clear a human price override (INR, whole rupees). */
export async function PATCH(req: Request, ctx: RouteContext<"/api/recommendations/[id]">) {
  return handle(async () => {
    const b = await readJson<{ approval?: unknown; priceOverride?: unknown }>(req);
    const patch: Parameters<ReturnType<typeof getDeps>["store"]["reviewRecommendation"]>[1] = {};
    if (b.approval !== undefined) {
      if (!["PENDING", "APPROVED", "REJECTED"].includes(b.approval as string)) throw new HttpError(400, "Unknown approval value.");
      patch.approval = b.approval as "PENDING" | "APPROVED" | "REJECTED";
    }
    if (b.priceOverride !== undefined) {
      if (b.priceOverride === null) patch.priceOverride = null;
      else {
        const o = b.priceOverride as { amountInr?: unknown; note?: unknown };
        if (!Number.isInteger(o.amountInr) || (o.amountInr as number) < 0 || (o.amountInr as number) > 100_000_000) throw new HttpError(400, "Price must be a whole number of rupees (0 to 100,000,000).");
        if (o.note !== undefined && (typeof o.note !== "string" || o.note.length > 500)) throw new HttpError(400, "Price note must be text of up to 500 characters.");
        patch.priceOverride = { amountInr: o.amountInr as number, note: o.note as string | undefined };
      }
    }
    await getDeps().store.reviewRecommendation((await ctx.params).id, patch, actorOf(req));
    return json({ ok: true });
  });
}
