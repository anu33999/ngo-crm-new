import { actorOf, handle, HttpError, json, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";

/** Edit a draft's text or mark it approved/rejected. Nothing is ever sent from here. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/drafts/[id]">) {
  return handle(async () => {
    const b = await readJson<{ editedBody?: unknown; status?: unknown }>(req);
    const patch: Parameters<ReturnType<typeof getDeps>["store"]["editDraft"]>[1] = {};
    if (b.editedBody !== undefined) {
      if (b.editedBody !== null && (typeof b.editedBody !== "string" || b.editedBody.length > 12_000)) throw new HttpError(400, "Draft text must be up to 12,000 characters.");
      patch.editedBody = b.editedBody as string | null;
    }
    if (b.status !== undefined) {
      if (!["DRAFT", "APPROVED", "REJECTED"].includes(b.status as string)) throw new HttpError(400, "Unknown draft status.");
      patch.status = b.status as "DRAFT" | "APPROVED" | "REJECTED";
    }
    await getDeps().store.editDraft((await ctx.params).id, patch, actorOf(req));
    return json({ ok: true });
  });
}
