import type { PageFacts } from "./extract";
import type { ComplianceItem, ComplianceKey } from "./types";
import type { SearchResult } from "@/lib/search/types";
import { classifyUrl, canonicalUrl } from "@/lib/search/normalize";
import { containsAllTokens } from "./text";

/**
 * Indian NGO registration signals.
 *
 * Statuses mean exactly this:
 *   VERIFIED     – a government-registry page returned in search names this organisation and the item
 *   UNVERIFIED   – the NGO itself claims it (own website) or a third-party directory lists it, but we did not
 *                  confirm it against the official registry
 *   NOT_FOUND    – nothing found in the sources checked (NOT proof the NGO lacks it)
 *   NOT_APPLICABLE – set only by a person
 *
 * The official portals (NGO Darpan, Income Tax e-filing, FCRA, MCA CSR) are interactive/captcha-protected
 * and are NOT queried programmatically; each item carries the portal link for manual verification.
 */

export const OFFICIAL_LOOKUPS: Record<ComplianceKey, { name: string; url: string }> = {
  "80G": { name: "Income Tax Department e-filing portal (80G/12A verification)", url: "https://www.incometax.gov.in" },
  "12A": { name: "Income Tax Department e-filing portal (80G/12A verification)", url: "https://www.incometax.gov.in" },
  FCRA: { name: "FCRA registration list (Ministry of Home Affairs)", url: "https://fcraonline.nic.in" },
  "CSR-1": { name: "Ministry of Corporate Affairs CSR portal", url: "https://www.csr.gov.in" },
  "NGO Darpan": { name: "NGO Darpan (NITI Aayog)", url: "https://ngodarpan.gov.in" },
};

const TERMS: Record<ComplianceKey, RegExp> = {
  "80G": /\b80\s?G\b/i,
  "12A": /\b12\s?A[AB]?\b/i,
  FCRA: /\bFCRA\b/i,
  "CSR-1": /\bCSR[\s-]?1\b/i,
  "NGO Darpan": /\b(ngo\s+)?darpan\b/i,
};

export function assessCompliance(args: {
  ngoName: string;
  results: SearchResult[];
  siteFacts: PageFacts[];
  siteUrl?: string;
}): ComplianceItem[] {
  const keys = Object.keys(TERMS) as ComplianceKey[];
  return keys.map((key) => {
    const lookup = OFFICIAL_LOOKUPS[key];
    const claimedOn = args.siteFacts.filter((f) => f.registrationMentions[key]).map((f) => f.url);

    const govHits = args.results.filter((r) => classifyUrl(r.url, r.title) === "GOVERNMENT_REGISTRY" && containsAllTokens(`${r.title} ${r.snippet}`, args.ngoName) && TERMS[key].test(`${r.title} ${r.snippet} ${r.url}`));
    const dirHits = args.results.filter((r) => classifyUrl(r.url, r.title) === "DIRECTORY" && containsAllTokens(`${r.title} ${r.snippet}`, args.ngoName) && TERMS[key].test(`${r.title} ${r.snippet}`));

    if (govHits.length) {
      return { key, status: "VERIFIED", statement: `A government-registry page returned in search names this organisation in connection with ${key}. Confirm the current status on the official portal before relying on it.`, evidenceUrls: govHits.map((r) => canonicalUrl(r.url)), officialLookup: lookup };
    }
    if (claimedOn.length || dirHits.length) {
      const bits = [claimedOn.length && "the NGO's own website", dirHits.length && "a third-party directory"].filter(Boolean).join(" and ");
      return { key, status: "UNVERIFIED", statement: `${key} is mentioned by ${bits}; it has not been checked against the official register.`, evidenceUrls: [...claimedOn, ...dirHits.map((r) => canonicalUrl(r.url))], officialLookup: lookup };
    }
    return {
      key,
      status: "NOT_FOUND",
      statement: `No mention of ${key} was found in the sources checked. This is not evidence that the NGO lacks it; the official register was not queried automatically.`,
      evidenceUrls: [],
      officialLookup: lookup,
    };
  });
}
