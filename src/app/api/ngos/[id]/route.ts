import { actorOf, handle, HttpError, json, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { parsePatch } from "@/lib/server/ngo-input";
import { composePayload } from "@/lib/server/view";

/** The saved audit (no re-scraping). 404 if the NGO has not been audited yet; use `?record=1` for the CRM record alone. */
export async function GET(req: Request, ctx: RouteContext<"/api/ngos/[id]">) {
  return handle(async () => {
    const deps = getDeps();
    const { id } = await ctx.params;
    if (new URL(req.url).searchParams.get("record")) {
      const rec = await deps.store.getRecord(id);
      if (!rec) throw new HttpError(404, "NGO not found.");
      return json({ record: rec });
    }
    const view = await deps.store.getNgoView(id);
    if (!view) throw new HttpError(404, "This NGO has not been audited yet.");
    return json(composePayload(view, deps.catalogue));
  });
}

/** CRM updates: contact/interest status, notes, phone, website, add/remove from CRM, follow-up date. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/ngos/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = parsePatch(await readJson(req));
    if (Object.keys(patch).length === 0) throw new HttpError(400, "Nothing to update.");
    try {
      return json({ record: await getDeps().store.updateRecord(id, patch, actorOf(req)) });
    } catch (e) {
      if (e instanceof Error && e.message === "ngo not found") throw new HttpError(404, "NGO not found.");
      throw e;
    }
  });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/ngos/[id]">) {
  return handle(async () => {
    await getDeps().store.deleteNgo((await ctx.params).id, actorOf(req));
    return json({ ok: true });
  });
}
