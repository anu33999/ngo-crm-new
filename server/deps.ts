import { createAnthropicClient } from "@/lib/ai/anthropic";
import { referenceCatalogue } from "@/lib/catalogue";
import { createFetcher } from "@/lib/research/fetcher";
import { MemoryResearchStore } from "@/lib/research/memory-store";
import { createPageSpeed } from "@/lib/research/pagespeed";
import type { PipelineDeps } from "@/lib/research/pipeline";
import { PrismaResearchStore } from "@/lib/research/prisma-store";
import type { ResearchStore } from "@/lib/research/store";
import { createSearch } from "@/lib/search";

/**
 * Wiring for server code. Everything is created lazily and once per process.
 *   RESEARCH_STORE=memory  → in-memory store (nothing persists; for a quick look without a database)
 *   otherwise              → Prisma (SQLite locally, Postgres in production)
 */
const g = globalThis as unknown as { __store?: ResearchStore; __deps?: PipelineDeps };

export function getStore(): ResearchStore {
  if (!g.__store) g.__store = process.env.RESEARCH_STORE === "memory" ? new MemoryResearchStore() : new PrismaResearchStore();
  return g.__store;
}

export function getDeps(): PipelineDeps {
  if (!g.__deps) {
    const env = process.env;
    g.__deps = {
      store: getStore(),
      search: createSearch(),
      fetcher: createFetcher(),
      catalogue: referenceCatalogue(),
      ai: createAnthropicClient(),
      pagespeed: createPageSpeed(),
      sender: env.SENDER_NAME ? { name: env.SENDER_NAME, role: env.SENDER_ROLE } : undefined,
    };
  }
  return g.__deps;
}

/** What is and is not configured — shown in the UI so a missing key is never a silent failure. */
export function configStatus() {
  const env = process.env;
  const search = createSearch();
  return {
    search: search.providers.map((p) => p.name),
    searchConfigured: search.isConfigured,
    /** "full" = a keyed provider is first; "reduced" = only the keyless DuckDuckGo fallback; "off" = no search. */
    searchMode: !search.isConfigured ? "off" : search.providers[0]?.name === "duckduckgo" ? "reduced" : "full",
    ai: !!env.ANTHROPIC_API_KEY,
    pagespeed: !!env.PAGESPEED_API_KEY,
    store: env.RESEARCH_STORE === "memory" ? "memory" : "database",
    accessGate: !!env.APP_ACCESS_PASSWORD,
  };
}
