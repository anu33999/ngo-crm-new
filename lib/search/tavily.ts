import { requestJson } from "./http";
import type { SearchOptions, SearchProvider, SearchResult } from "./types";

interface TavilyResponse {
  results?: { title?: string; url?: string; content?: string; score?: number; published_date?: string }[];
}

export class TavilyProvider implements SearchProvider {
  readonly name = "tavily";
  constructor(private apiKey: string | undefined = process.env.TAVILY_API_KEY) {}

  isConfigured() {
    return !!this.apiKey;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const data = await requestJson<TavilyResponse>(
      this.name,
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          query,
          max_results: opts.maxResults ?? 10,
          search_depth: "basic",
          include_domains: opts.includeDomains,
          exclude_domains: opts.excludeDomains,
        }),
      },
      { signal: opts.signal },
    );
    return (data.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({
        url: r.url as string,
        title: r.title ?? "",
        snippet: r.content ?? "",
        score: r.score,
        publishedAt: r.published_date,
        provider: this.name,
      }));
  }
}
