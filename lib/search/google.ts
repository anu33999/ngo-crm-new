import { requestJson } from "./http";
import type { SearchOptions, SearchProvider, SearchResult } from "./types";

interface GoogleResponse {
  items?: { title?: string; link?: string; snippet?: string }[];
}

/** Google Programmable Search JSON API (needs GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID). */
export class GoogleProvider implements SearchProvider {
  readonly name = "google";
  constructor(
    private apiKey: string | undefined = process.env.GOOGLE_SEARCH_API_KEY,
    private engineId: string | undefined = process.env.GOOGLE_SEARCH_ENGINE_ID,
  ) {}

  isConfigured() {
    return !!this.apiKey && !!this.engineId;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const url =
      `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(this.apiKey as string)}` +
      `&cx=${encodeURIComponent(this.engineId as string)}&q=${encodeURIComponent(query)}&num=${Math.min(opts.maxResults ?? 10, 10)}`;
    const data = await requestJson<GoogleResponse>(this.name, url, {}, { signal: opts.signal });
    return (data.items ?? [])
      .filter((r) => r.link)
      .map((r, i) => ({ url: r.link as string, title: r.title ?? "", snippet: r.snippet ?? "", score: 1 - i / 20, provider: this.name }));
  }
}
