import { BraveProvider } from "./brave";
import { DuckDuckGoProvider } from "./duckduckgo";
import { GoogleProvider } from "./google";
import { TavilyProvider } from "./tavily";
import { TinyFishProvider } from "./tinyfish";
import type { SearchOptions, SearchOutcome, SearchProvider } from "./types";

export * from "./types";

/**
 * Provider chain: SEARCH_PROVIDER (default "tavily") first, then the other configured
 * providers in order as fallbacks. Add a new provider by implementing SearchProvider and
 * registering it in `registry` below.
 */
const registry: Record<string, (env: NodeJS.ProcessEnv) => SearchProvider> = {
  tavily: (env) => new TavilyProvider(env.TAVILY_API_KEY),
  tinyfish: (env) => new TinyFishProvider(env.TINYFISH_API_KEY),
  brave: (env) => new BraveProvider(env.BRAVE_SEARCH_API_KEY),
  google: (env) => new GoogleProvider(env.GOOGLE_SEARCH_API_KEY, env.GOOGLE_SEARCH_ENGINE_ID),
};

/**
 * Keyed providers first (SEARCH_PROVIDER, then the others that have keys), then keyless DuckDuckGo as the last resort,
 * so the app works with no API key at all. Set KEYLESS_SEARCH=off to disable the keyless fallback.
 */
export function getProviderChain(env: NodeJS.ProcessEnv = process.env): SearchProvider[] {
  const primary = (env.SEARCH_PROVIDER ?? "tavily").toLowerCase();
  const order = [primary, ...Object.keys(registry).filter((k) => k !== primary)];
  const keyed = order.filter((k) => registry[k]).map((k) => registry[k](env)).filter((p) => p.isConfigured());
  const keyless = new DuckDuckGoProvider((env.KEYLESS_SEARCH ?? "on").toLowerCase() !== "off");
  return keyless.isConfigured() ? (primary === "duckduckgo" ? [keyless, ...keyed] : [...keyed, keyless]) : keyed;
}

export function createSearch(providers: SearchProvider[] = getProviderChain()) {
  return {
    providers,
    isConfigured: providers.length > 0,
    /** Tries each provider in turn; never throws. */
    async search(query: string, opts: SearchOptions = {}): Promise<SearchOutcome> {
      const errors: SearchOutcome["errors"] = [];
      if (providers.length === 0) {
        return {
          query,
          provider: null,
          results: [],
          ok: false,
          errors: [{ provider: "none", message: "No search provider configured (set TINYFISH_API_KEY, TAVILY_API_KEY, BRAVE_SEARCH_API_KEY or GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID)." }],
        };
      }
      for (const p of providers) {
        try {
          const results = await p.search(query, opts);
          return { query, provider: p.name, results, errors, ok: true };
        } catch (e) {
          errors.push({ provider: p.name, message: e instanceof Error ? e.message : String(e) });
          if (opts.signal?.aborted) break;
        }
      }
      return { query, provider: null, results: [], errors, ok: false };
    },
  };
}

export type SearchClient = ReturnType<typeof createSearch>;
