import type { SearchResult } from "./types";

const TWO_LEVEL_SUFFIXES = new Set([
  "co.in", "org.in", "net.in", "gov.in", "nic.in", "ac.in", "edu.in", "res.in", "firm.in", "gen.in", "ind.in",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "org.au", "co.nz", "org.nz", "co.za", "org.za", "com.sg", "com.np", "org.np",
]);

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|igshid|mc_|ref$|ref_|_hs|mkt_tok|si$)/i;

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** eTLD+1 for the hosts we meet (handles the two-level suffixes common for Indian NGOs). */
export function registrableDomain(hostOrUrl: string): string | null {
  const host = hostOrUrl.includes("/") ? hostOf(hostOrUrl) : hostOrUrl.toLowerCase().replace(/^www\./, "");
  if (!host) return null;
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join(".");
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    if (u.port === "443" || u.port === "80") u.port = "";
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    let s = u.toString();
    if (u.pathname === "/" && !u.search) s = s.replace(/\/$/, "");
    return s;
  } catch {
    return raw.trim();
  }
}

/** Merge results that point at the same canonical URL; keep the richest snippet and best score. */
export function dedupeResults(results: SearchResult[]): SearchResult[] {
  const byUrl = new Map<string, SearchResult & { providers: string[] }>();
  for (const r of results) {
    const key = canonicalUrl(r.url);
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { ...r, url: key, providers: [r.provider] });
    } else {
      if (r.snippet.length > existing.snippet.length) existing.snippet = r.snippet;
      if (r.title.length > existing.title.length) existing.title = r.title;
      existing.score = Math.max(existing.score ?? 0, r.score ?? 0);
      if (!existing.providers.includes(r.provider)) existing.providers.push(r.provider);
      existing.publishedAt ??= r.publishedAt;
    }
  }
  return [...byUrl.values()].map(({ providers, ...rest }) => ({ ...rest, provider: providers.join("+") }));
}

// ── source classification ───────────────────────────────────────────────────

export type UrlKind = "SOCIAL" | "GOVERNMENT_REGISTRY" | "DIRECTORY" | "NEWS" | "ANNUAL_REPORT" | "GENERIC" | "OTHER";

const SOCIAL = ["instagram.com", "facebook.com", "fb.com", "fb.me", "linkedin.com", "youtube.com", "youtu.be", "x.com", "twitter.com", "threads.net", "t.me", "whatsapp.com", "wa.me"];
const DIRECTORIES = ["guidestarindia.org", "guidestar.org", "ngobox.org", "giveindia.org", "globalgiving.org", "charitynavigator.org", "ngosindia.com", "ngodarpan.in", "indiaspend.com", "causeaffect.org", "donatekart.com", "milaap.org", "ketto.org", "impactguru.com", "benevity.org", "csrbox.org", "sayfty.com", "ngos.in", "ngoindia.org", "causes.in", "tofler.in", "zaubacorp.com", "instafinancials.com", "thecsrjournal.in", "idealist.org", "crunchbase.com", "ngotimes.com"];
const NEWS = ["thehindu.com", "timesofindia.indiatimes.com", "indiatimes.com", "hindustantimes.com", "indianexpress.com", "deccanchronicle.com", "thenewsminute.com", "newindianexpress.com", "ndtv.com", "news18.com", "scroll.in", "theprint.in", "livemint.com", "business-standard.com", "thehindubusinessline.com", "telegraphindia.com", "tribuneindia.com", "deccanherald.com", "mid-day.com", "firstpost.com", "yourstory.com", "thebetterindia.com", "telanganatoday.com", "siasat.com", "bbc.com", "reuters.com", "theguardian.com", "outlookindia.com", "indiatoday.in", "financialexpress.com", "devdiscourse.com", "ptinews.com", "ani.in"];
const GENERIC = ["wikipedia.org", "wikidata.org", "quora.com", "reddit.com", "pinterest.com", "justdial.com", "indiamart.com", "sulekha.com", "yelp.com", "tripadvisor.com", "medium.com", "amazon.in", "amazon.com", "flipkart.com", "glassdoor.co.in", "glassdoor.com", "naukri.com", "indeed.com", "play.google.com", "apps.apple.com", "google.com", "bing.com"];

function matchesDomain(host: string, list: string[]) {
  return list.some((d) => host === d || host.endsWith(`.${d}`));
}

export function classifyUrl(url: string, title = ""): UrlKind {
  const host = hostOf(url);
  if (!host) return "OTHER";
  if (matchesDomain(host, SOCIAL)) return "SOCIAL";
  if (host.endsWith(".gov.in") || host.endsWith(".nic.in") || host === "gov.in" || host === "nic.in") return "GOVERNMENT_REGISTRY";
  if (matchesDomain(host, DIRECTORIES)) return "DIRECTORY";
  if (matchesDomain(host, NEWS)) return "NEWS";
  if (matchesDomain(host, GENERIC)) return "GENERIC";
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    /* ignore */
  }
  if (path.endsWith(".pdf") && /report|annual|impact|audit|financial/i.test(`${path} ${title}`)) return "ANNUAL_REPORT";
  if (/(^|\/)news(\/|$)/.test(path) && host.split(".").length >= 3) return "NEWS";
  return "OTHER";
}

// ── social URL parsing ──────────────────────────────────────────────────────

export type Platform = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "YOUTUBE" | "X" | "OTHER";
export interface SocialRef {
  platform: Platform;
  kind: "profile" | "content" | "person";
  handle: string;
  profileUrl: string;
}

const IG_RESERVED = new Set(["p", "reel", "reels", "explore", "stories", "tv", "accounts", "directory", "about", "legal", "web", "developer", "challenge", "popular"]);
const FB_RESERVED = new Set(["sharer", "sharer.php", "share", "share.php", "dialog", "plugins", "tr", "watch", "events", "groups", "marketplace", "login", "login.php", "photo", "photo.php", "permalink.php", "story.php", "hashtag", "policies", "help", "gaming", "reel", "reels", "video", "videos", "public", "people", "pages", "profile.php", "l.php", "flx", "ads", "business", "privacy", "terms"]);

export function parseSocialUrl(raw: string): SocialRef | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, "");
  const seg = u.pathname.split("/").filter(Boolean);
  if (host === "instagram.com") {
    if (!seg.length) return null;
    const h = seg[0].toLowerCase();
    if (IG_RESERVED.has(h)) return null;
    return { platform: "INSTAGRAM", kind: seg.length > 1 && ["p", "reel", "tv"].includes(seg[1]) ? "content" : "profile", handle: h, profileUrl: `https://www.instagram.com/${h}/` };
  }
  if (host === "facebook.com" || host === "fb.com") {
    if (!seg.length) return null;
    if (seg[0] === "profile.php") {
      const id = u.searchParams.get("id");
      return id ? { platform: "FACEBOOK", kind: "profile", handle: id, profileUrl: `https://www.facebook.com/profile.php?id=${id}` } : null;
    }
    if (seg[0] === "people" && seg.length >= 3) {
      return { platform: "FACEBOOK", kind: "profile", handle: seg[2], profileUrl: `https://www.facebook.com/people/${seg[1]}/${seg[2]}/` };
    }
    const h = seg[0];
    if (FB_RESERVED.has(h.toLowerCase())) return null;
    return { platform: "FACEBOOK", kind: seg.length > 1 && ["posts", "photos", "videos"].includes(seg[1]) ? "content" : "profile", handle: h, profileUrl: `https://www.facebook.com/${h}` };
  }
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    if (seg.length >= 2 && ["company", "school", "showcase"].includes(seg[0])) {
      return { platform: "LINKEDIN", kind: "profile", handle: seg[1], profileUrl: `https://www.linkedin.com/${seg[0]}/${seg[1]}/` };
    }
    if (seg.length >= 2 && seg[0] === "in") return { platform: "LINKEDIN", kind: "person", handle: seg[1], profileUrl: `https://www.linkedin.com/in/${seg[1]}/` };
    return null;
  }
  if (host === "youtube.com" || host === "youtu.be") {
    if (host === "youtu.be") return null;
    if (seg[0]?.startsWith("@")) return { platform: "YOUTUBE", kind: "profile", handle: seg[0], profileUrl: `https://www.youtube.com/${seg[0]}` };
    if (seg.length >= 2 && ["channel", "c", "user"].includes(seg[0])) return { platform: "YOUTUBE", kind: "profile", handle: seg[1], profileUrl: `https://www.youtube.com/${seg[0]}/${seg[1]}` };
    return null;
  }
  if (host === "x.com" || host === "twitter.com") {
    const h = seg[0];
    if (!h || ["share", "intent", "home", "i", "search", "hashtag"].includes(h.toLowerCase())) return null;
    return { platform: "X", kind: "profile", handle: h, profileUrl: `https://x.com/${h}` };
  }
  return null;
}
