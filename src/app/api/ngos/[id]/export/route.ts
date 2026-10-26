import { actorOf, handle, HttpError } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { pricingFor } from "@/lib/pitch/from-view";
import { evidenceCsv, ExportBlocked, internalReport, internalXlsx, modelToPdf, ngoFacingReport, proposalDoc } from "@/lib/export/ngo";

export const maxDuration = 60;

const TYPES = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv; charset=utf-8" } as const;

/**
 * GET /api/ngos/:id/export?kind=report|proposal|evidence&mode=INTERNAL|NGO_FACING&format=pdf|xlsx|csv
 * NGO_FACING output omits scores, internal economics and anything a reviewer rejected or excluded, and is
 * blocked outright if it would mention internal information.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/ngos/[id]/export">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const sp = new URL(req.url).searchParams;
    const kind = sp.get("kind") ?? "report";
    const mode = sp.get("mode") === "NGO_FACING" ? "NGO_FACING" : "INTERNAL";
    const format = (sp.get("format") ?? "pdf") as keyof typeof TYPES;
    if (!(format in TYPES)) throw new HttpError(400, "format must be pdf, xlsx or csv.");

    const deps = getDeps();
    const view = await deps.store.getNgoView(id);
    if (!view) throw new HttpError(404, "This NGO has not been audited yet, so there is nothing to export.");
    const pricing = pricingFor(view, deps.catalogue);
    const now = new Date().toISOString();

    let body: Buffer | string;
    try {
      if (kind === "evidence" && mode === "INTERNAL" && format === "csv") body = evidenceCsv(view);
      else if (kind === "report" && mode === "INTERNAL" && format === "pdf") body = await modelToPdf(internalReport(view, pricing, now));
      else if (kind === "report" && mode === "INTERNAL" && format === "xlsx") body = await internalXlsx(view, pricing, now);
      else if (kind === "report" && mode === "NGO_FACING" && format === "pdf") body = await modelToPdf(ngoFacingReport(view, pricing, now));
      else if (kind === "proposal" && mode === "NGO_FACING" && format === "pdf") body = await modelToPdf(proposalDoc(view, pricing, now));
      else throw new HttpError(400, "That combination of kind, mode and format is not available.");
    } catch (e) {
      if (e instanceof ExportBlocked) throw new HttpError(e.status, e.message);
      throw e;
    }

    await deps.store.recordExport(id, `${kind}:${format}`, mode, actorOf(req));
    const slug = view.ngo.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "ngo";
    const file = `${slug}-${kind}-${mode === "NGO_FACING" ? "ngo-facing" : "internal"}-${now.slice(0, 10)}.${format}`;
    return new Response(body as BodyInit, { headers: { "content-type": TYPES[format], "content-disposition": `attachment; filename="${file}"`, "cache-control": "no-store" } });
  });
}
