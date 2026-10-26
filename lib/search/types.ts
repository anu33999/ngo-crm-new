export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
  score?: number;
  provider: string;
}

export interface SearchOptions {
  maxResults?: number;
  signal?: AbortSignal;
  includeDomains?: string[];
  excludeDomains?: string[];
}

export interface SearchProvider {
  readonly name: string;
  isConfigured(): boolean;
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
}

export class SearchProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
  ) {
    super(`[${provider}] ${message}`);
  }
}

/** Outcome of one query across the provider chain. Failures are data, never exceptions. */
export interface SearchOutcome {
  query: string;
  provider: string | null;
  results: SearchResult[];
  errors: { provider: string; message: string }[];
  ok: boolean;
}
