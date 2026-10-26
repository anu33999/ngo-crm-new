import { actorOf, handle, HttpError, json, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { NOTE_MAX } from "@/lib/crm/types";

export async function GET(_req: Request, ctx: RouteContext<"/api/ngos/[id]/notes">) {
  return handle(async () => json({ notes: await getDeps().store.listCrmNotes((await ctx.params).id) }));
}

/** Append a timestamped note to the NGO's activity log. */
export async function POST(req: Request, ctx: RouteContext<"/api/ngos/[id]/notes">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const b = await readJson<{ content?: unknown }>(req);
    const content = typeof b.content === "string" ? b.content.trim() : "";
    if (!content) throw new HttpError(400, "Write something first.");
    if (content.length > NOTE_MAX) throw new HttpError(400, `Notes can be up to ${NOTE_MAX} characters.`);
    const { store } = getDeps();
    if (!(await store.getRecord(id))) throw new HttpError(404, "NGO not found.");
    return json({ note: await store.addCrmNote(id, content, actorOf(req)) }, 201);
  });
}
