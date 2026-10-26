import { describe, expect, it } from "vitest";
import { canonicalUrl, classifyUrl, dedupeResults, parseSocialUrl, registrableDomain } from "@/lib/search/normalize";
import { createSearch, getProviderChain } from "@/lib/search";
import type { SearchProvider } from "@/lib/search";
import { dice, nameSimilarity, normalizeName } from "@/lib/research/text";

describe("URL normalisation", () => {
  it("canonicalises: https, no www, no tracking params, no fragment, no trailing slash", () => {
    expect(canonicalUrl("http://www.Example.org/about/?utm_source=a&b=1&fbclid=zz#team")).toBe("https://example.org/about?b=1");
    expect(canonicalUrl("https://example.org/")).toBe("https://example.org");
  });

  it("finds registrable domains incl. Indian two-level suffixes", () => {
    expect(registrableDomain("https://www.hopefoundation.org.in/x")).toBe("hopefoundation.org.in");
    expect(registrableDomain("blog.example.co.in")).toBe("example.co.in");
    expect(registrableDomain("https://sub.example.org")).toBe("example.org");
  });

  it("deduplicates results by canonical URL and keeps the richest snippet", () => {
    const out = dedupeResults([
      { url: "https://www.x.org/a?utm_medium=1", title: "A", snippet: "short", provider: "tavily", score: 0.2 },
      { url: "http://x.org/a/", title: "A longer title", snippet: "a much longer snippet", provider: "brave", score: 0.9 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ url: "https://x.org/a", snippet: "a much longer snippet", score: 0.9, provider: "tavily+brave" });
  });

  it("classifies source kinds", () => {
    expect(classifyUrl("https://www.instagram.com/x/")).toBe("SOCIAL");
    expect(classifyUrl("https://ngodarpan.gov.in/")).toBe("GOVERNMENT_REGISTRY");
    expect(classifyUrl("https://www.guidestarindia.org/x")).toBe("DIRECTORY");
    expect(classifyUrl("https://www.thehindu.com/news/a")).toBe("NEWS");
    expect(classifyUrl("https://ngo.org/files/annual-report-2024.pdf", "Annual Report")).toBe("ANNUAL_REPORT");
    expect(classifyUrl("https://some-ngo.org/")).toBe("OTHER");
  });
});

describe("social URL parsing", () => {
  it("accepts profiles and rejects share / post / reserved URLs as profiles", () => {
    expect(parseSocialUrl("https://www.instagram.com/asha.kiran/")).toMatchObject({ platform: "INSTAGRAM", kind: "profile", handle: "asha.kiran" });
    expect(parseSocialUrl("https://www.instagram.com/p/ABC123/")).toBeNull();
    expect(parseSocialUrl("https://www.facebook.com/sharer/sharer.php?u=x")).toBeNull();
    expect(parseSocialUrl("https://www.facebook.com/AshaKiran")).toMatchObject({ platform: "FACEBOOK", handle: "AshaKiran" });
    expect(parseSocialUrl("https://in.linkedin.com/company/asha-kiran/")).toMatchObject({ platform: "LINKEDIN", kind: "profile", handle: "asha-kiran" });
    expect(parseSocialUrl("https://www.linkedin.com/in/someone")).toMatchObject({ kind: "person" });
    expect(parseSocialUrl("https://www.youtube.com/@AshaKiran")).toMatchObject({ platform: "YOUTUBE", handle: "@AshaKiran" });
    expect(parseSocialUrl("https://www.youtube.com/watch?v=abc")).toBeNull();
  });
});

describe("name similarity", () => {
  it("ignores case, punctuation, word order and filler words", () => {
    expect(normalizeName("The  Asha-Kiran Foundation!")).toBe("the asha kiran foundation");
    expect(nameSimilarity("Asha Kiran Foundation", "foundation asha kiran")).toBeGreaterThan(0.8);
    expect(nameSimilarity("Asha Kiran Foundation", "Hope Foundation")).toBeLessThan(0.45);
    expect(dice("night", "nacht")).toBeCloseTo(0.25, 2);
  });
});

describe("provider chain", () => {
  const failing: SearchProvider = { name: "a", isConfigured: () => true, search: async () => { throw new Error("boom"); } };
  const working: SearchProvider = { name: "b", isConfigured: () => true, search: async () => [{ url: "https://x.org", title: "t", snippet: "s", provider: "b" }] };

  it("falls back to the next provider and records the failure instead of throwing", async () => {
    const out = await createSearch([failing, working]).search("q");
    expect(out.ok).toBe(true);
    expect(out.provider).toBe("b");
    expect(out.errors).toEqual([{ provider: "a", message: "boom" }]);
  });

  it("returns ok=false (no exception, no fabricated results) when every provider fails or none is configured", async () => {
    expect((await createSearch([failing]).search("q")).ok).toBe(false);
    const none = await createSearch([]).search("q");
    expect(none).toMatchObject({ ok: false, results: [] });
    expect(none.errors[0].message).toMatch(/No search provider configured/);
  });

  it("builds the chain from env: primary first, only configured providers", () => {
    const chain = getProviderChain({ SEARCH_PROVIDER: "brave", BRAVE_SEARCH_API_KEY: "k", TAVILY_API_KEY: "t" } as unknown as NodeJS.ProcessEnv);
    expect(chain.map((p) => p.name)).toEqual(["brave", "tavily", "duckduckgo"]);
    expect(getProviderChain({ KEYLESS_SEARCH: "off" } as unknown as NodeJS.ProcessEnv)).toEqual([]);
  });
});
