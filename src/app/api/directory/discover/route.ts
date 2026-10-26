import { actorOf, handle, HttpError, json, rateLimit, readJson } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { sanitizeUntrusted } from "@/lib/ai/untrusted";
import { classifyUrl } from "@/lib/search/normalize";

/**
 * POST /api/directory/discover { city, area?, cause? }
 * Runs a web search and returns the raw results for a person to review. Nothing is added automatically:
 * search results are web pages, not a registry, so a person decides which are NGOs and confirms them via POST /api/ngos.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const b = await readJson<{ city?: unknown; area?: unknown; cause?: unknown }>(req);
    const clean = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001F]/g, " ").trim().slice(0, 80) : "");
    const city = clean(b.city);
    if (!city) throw new HttpError(400, "Choose a city.");
    const area = clean(b.area);
    const cause = clean(b.cause);
    const { search } = getDeps();
    if (!search.isConfigured) throw new HttpError(400, "Search is turned off (KEYLESS_SEARCH=off and no search key in .env).");
    rateLimit(`discover:${actorOf(req)}`, 20, 60 * 60 * 1000);
    const where = [area, city].filter(Boolean).join(", ");
    const query = `${cause ? `${cause} ` : ""}NGO charitable trust foundation in ${where}`;
    const out = await search.search(query, { maxResults: 10 });
    if (!out.ok) throw new HttpError(502, `The search provider returned an error: ${out.errors.map((e) => e.message).join("; ").slice(0, 200)}`);
    const results = out.results.map((r) => ({
      title: sanitizeUntrusted(r.title, 160).text,
      snippet: sanitizeUntrusted(r.snippet, 280).text,
      url: r.url,
      kind: classifyUrl(r.url, r.title),
    }));
    return json({ query, provider: out.provider ?? null, results, note: "These are search results, not a verified list. Add only the ones you recognise as NGOs." });
  });
}
