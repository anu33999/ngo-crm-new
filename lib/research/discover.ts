import { canonicalUrl, classifyUrl, hostOf, parseSocialUrl, registrableDomain, type Platform } from "@/lib/search/normalize";
import type { SearchResult } from "@/lib/search/types";
import { dice, normalizeName, tokens } from "./text";
import type { FindingDraft, SocialDraft } from "./types";
import type { PageFacts } from "./extract";
import { FRAMEWORK_BY_ID } from "./framework";

const PLATFORMS: Platform[] = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "YOUTUBE"];
const LABEL: Record<string, string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", LINKEDIN: "LinkedIn", YOUTUBE: "YouTube", X: "X", OTHER: "Other" };

function handleSimilarity(handle: string, name: string) {
  const h = handle.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]/g, "");
  const joined = tokens(name).join("");
  if (!h || !joined) return 0;
  if (h.includes(joined) || joined.includes(h)) return 1;
  return dice(h, joined);
}

/**
 * Social discovery. A profile linked from the NGO's own website is "official"; one found only through
 * search is a candidate, accepted only when its handle clearly resembles the NGO's name.
 * Automated access to these platforms is restricted, so access state is never ACCESSIBLE unless proven.
 */
export function discoverSocial(args: { ngoName: string; siteFacts: PageFacts[]; results: SearchResult[] }): SocialDraft[] {
  const found = new Map<Platform, SocialDraft>();

  for (const f of args.siteFacts) {
    for (const link of f.socialLinks) {
      const ref = parseSocialUrl(link);
      if (!ref || ref.kind !== "profile" || !PLATFORMS.includes(ref.platform)) continue;
      if (!found.has(ref.platform)) found.set(ref.platform, { platform: ref.platform, url: ref.profileUrl, accessState: "INACCESSIBLE", isOfficial: true, basis: `Linked from the NGO's own website (${f.url})` });
    }
  }
  for (const r of args.results) {
    if (classifyUrl(r.url) !== "SOCIAL") continue;
    const ref = parseSocialUrl(r.url);
    if (!ref || ref.kind !== "profile" || !PLATFORMS.includes(ref.platform) || found.has(ref.platform)) continue;
    if (handleSimilarity(ref.handle, args.ngoName) < 0.7) continue;
    found.set(ref.platform, { platform: ref.platform, url: ref.profileUrl, accessState: "INACCESSIBLE", isOfficial: false, basis: `Found in search results; handle “${ref.handle}” resembles the NGO name but it is not linked from the website — confirm it is official` });
  }

  return PLATFORMS.map((p) => found.get(p) ?? { platform: p as SocialDraft["platform"], url: null, accessState: "NOT_LOCATED", isOfficial: false, basis: "No profile found via the NGO's website or search results checked" });
}

export function socialFindings(profiles: SocialDraft[], siteChecked: boolean, checkedAt: string): FindingDraft[] {
  const area = FRAMEWORK_BY_ID.social;
  const base = { areaId: "social" as const, category: area.category, mayAddressOffline: false, checkedAt, whyItMatters: area.whyItMatters, consequence: area.consequence };
  const out: FindingDraft[] = [];
  for (const p of profiles) {
    const label = LABEL[p.platform];
    if (p.url) {
      out.push({
        ...base, key: `social.${p.platform.toLowerCase()}`, section: "EXISTING",
        title: `${label} profile ${p.isOfficial ? "linked from website" : "found (unconfirmed)"}`,
        observation: `${label}: ${p.url}. ${p.basis}. Posting frequency, latest post and engagement could not be observed because ${label} restricts automated access; inaccessibility is not evidence of inactivity.`,
        assessment: p.isOfficial ? "ADEQUATE" : "UNKNOWN", confidence: p.isOfficial ? "HIGH" : "LOW", pageUrl: p.url, evidenceUrls: [p.url],
      });
    } else if (!siteChecked) {
      out.push({
        ...base, key: `social.${p.platform.toLowerCase()}`, section: "GAP", gapState: "UNABLE_TO_ASSESS",
        title: `${label} presence could not be assessed`,
        observation: `No ${label} profile appeared in search results, but the NGO's website (where profiles are usually linked) could not be inspected, so search alone is not enough to say anything about its ${label} presence.`,
        assessment: "UNKNOWN", confidence: "HIGH", evidenceUrls: [],
      });
    } else {
      out.push({
        ...base, key: `social.${p.platform.toLowerCase()}`, section: "GAP", gapState: "NOT_FOUND_PUBLICLY",
        title: `No ${label} profile found in the sources checked`,
        observation: `No ${label} profile was found linked from the website or in search results. The NGO may have one that is not linked or not indexed.`,
        assessment: "UNKNOWN", confidence: "LOW", priority: p.platform === "YOUTUBE" ? "LOW" : "MEDIUM", evidenceUrls: [],
        recommendedAction: `Confirm whether the NGO has a ${label} presence; if not, decide whether the channel suits its audience.`,
      });
    }
  }
  const located = profiles.filter((p) => p.url).length;
  if (located > 0) {
    out.push({
      ...base, key: "social.activity", section: "GAP", gapState: "UNABLE_TO_ASSESS",
      title: "Social posting consistency could not be observed",
      observation: `${located} profile(s) located, but posting consistency, latest posts, content formats and engagement are not available to automated checks. Review the profiles manually before using any claim about activity in outreach.`,
      assessment: "UNKNOWN", confidence: "HIGH", evidenceUrls: profiles.filter((p) => p.url).map((p) => p.url as string),
    });
  }
  return out;
}

/** Findings from brand-name search results (what a provider returned — not Google rankings). */
export function searchPresenceFindings(args: { ngoName: string; officialDomain?: string; provider?: string; results: SearchResult[]; checkedAt: string }): FindingDraft[] {
  const area = FRAMEWORK_BY_ID["search-seo"];
  const base = { areaId: "search-seo" as const, category: area.category, mayAddressOffline: false, checkedAt: args.checkedAt, whyItMatters: area.whyItMatters, consequence: area.consequence };
  if (!args.provider || args.results.length === 0) {
    return [{ ...base, key: "search.brand", section: "GAP", gapState: "UNABLE_TO_ASSESS", title: "Brand-search visibility could not be assessed", observation: "The brand-name search returned no results (or no search provider was available), so brand visibility was not assessed. No ranking claims are made.", assessment: "UNKNOWN", confidence: "HIGH", evidenceUrls: [] }];
  }
  const top = args.results.slice(0, 10);
  const hits = args.officialDomain ? top.filter((r) => registrableDomain(r.url) === args.officialDomain) : [];
  const norm = normalizeName(args.ngoName);
  if (args.officialDomain && hits.length) {
    const first = top.findIndex((r) => registrableDomain(r.url) === args.officialDomain) + 1;
    return [{ ...base, key: "search.brand", section: "EXISTING", title: "Official site appears for the brand-name query", observation: `For the query “${args.ngoName}”, ${args.provider} returned ${hits.length} page(s) from ${args.officialDomain} among its top ${top.length} results (first at position ${first}). This reflects one provider's results at one moment, not Google rankings.`, assessment: first <= 3 ? "STRONG" : "ADEQUATE", confidence: "MEDIUM", evidenceUrls: hits.map((h) => canonicalUrl(h.url)) }];
  }
  if (args.officialDomain) {
    return [{ ...base, key: "search.brand", section: "GAP", gapState: "LIKELY_OPPORTUNITY", title: "Official site not seen in top brand-query results", observation: `For the query “${args.ngoName}”, ${args.provider} did not return ${args.officialDomain} among its top ${top.length} results. This is one provider's results at one moment; check Google Search Console or run the query in Google directly before concluding anything.`, assessment: "NEEDS_IMPROVEMENT", confidence: "LOW", priority: "MEDIUM", evidenceUrls: top.slice(0, 3).map((r) => canonicalUrl(r.url)), recommendedAction: "Check brand-query visibility in Google and Search Console." }];
  }
  return [{ ...base, key: "search.brand", section: "GAP", gapState: "UNABLE_TO_ASSESS", title: "Brand-search visibility could not be assessed", observation: `No official domain was established for “${norm}”, so brand-query visibility was not assessed.`, assessment: "UNKNOWN", confidence: "HIGH", evidenceUrls: [] }];
}

export function hostLabel(url: string) {
  return hostOf(url) ?? url;
}
