import { requestJson } from "./http";
import type { SearchOptions, SearchProvider, SearchResult } from "./types";

interface BraveResponse {
  web?: { results?: { title?: string; url?: string; description?: string; page_age?: string }[] };
}

export class BraveProvider implements SearchProvider {
  readonly name = "brave";
  constructor(private apiKey: string | undefined = process.env.BRAVE_SEARCH_API_KEY) {}

  isConfigured() {
    return !!this.apiKey;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const q = opts.includeDomains?.length
      ? `${query} ${opts.includeDomains.map((d) => `site:${d}`).join(" OR ")}`
      : query;
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${Math.min(opts.maxResults ?? 10, 20)}`;
    const data = await requestJson<BraveResponse>(
      this.name,
      url,
      { headers: { accept: "application/json", "x-subscription-token": this.apiKey as string } },
      { signal: opts.signal },
    );
    return (data.web?.results ?? [])
      .filter((r) => r.url)
      .map((r, i) => ({
        url: r.url as string,
        title: r.title ?? "",
        snippet: stripTags(r.description ?? ""),
        publishedAt: r.page_age,
        score: 1 - i / 20,
        provider: this.name,
      }));
  }
}

function stripTags(s: string) {
  return s.replace(/<[^>]+>/g, "");
}
