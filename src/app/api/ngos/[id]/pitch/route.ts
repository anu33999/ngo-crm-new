import { generatePitch } from "@/lib/pitch/generate";
import { pitchFactsFromView } from "@/lib/pitch/from-view";
import { TONES, type Tone } from "@/lib/pitch/types";
import { getDeps } from "@/lib/server/deps";
import { handle, HttpError, json, rateLimit, readJson, actorOf } from "@/lib/server/http";

export const maxDuration = 120;

/** Regenerate the pitch (all channels) in a chosen tone, from the stored research and the current review decisions. */
export async function POST(req: Request, ctx: RouteContext<"/api/ngos/[id]/pitch">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = await readJson<{ tone?: unknown }>(req);
    const tone = body.tone as Tone;
    if (!TONES.includes(tone)) throw new HttpError(400, `Tone must be one of: ${TONES.join(", ")}.`);
    rateLimit(`pitch:${actorOf(req)}`, 60, 60 * 60 * 1000);
    const deps = getDeps();
    const view = await deps.store.getNgoView(id);
    if (!view) throw new HttpError(404, "NGO not found.");
    const { facts } = pitchFactsFromView(view, deps.catalogue, deps.sender);
    const bundle = await generatePitch({ facts, tone, ai: deps.ai, signal: req.signal });
    const pitch = await deps.store.savePitch(id, view.job?.id ?? null, view.policy?.id ?? null, bundle, view.pitches[0]?.id);
    return json(pitch, 201);
  });
}
