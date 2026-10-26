import { actorOf, handle, HttpError, isHttpUrl, json, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { sanitizeUntrusted } from "@/lib/ai/untrusted";

/** A person adds a source the automated research missed. Stored as USER_ADDED evidence. */
export async function POST(req: Request, ctx: RouteContext<"/api/ngos/[id]/evidence">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const b = await readJson<{ url?: unknown; title?: unknown; summary?: unknown }>(req);
    if (!isHttpUrl(b.url)) throw new HttpError(400, "Enter a valid http(s) address.");
    const title = typeof b.title === "string" ? sanitizeUntrusted(b.title, 160).text : undefined;
    const summary = typeof b.summary === "string" ? sanitizeUntrusted(b.summary, 500).text : undefined;
    return json(await getDeps().store.addEvidenceNote(id, { url: b.url, title, summary }, actorOf(req)), 201);
  });
}
