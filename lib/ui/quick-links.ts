import type { NgoView } from "@/lib/research/store";

export interface QuickLink { label: string; url: string; note?: string }
export interface QuickLinkGroups { website: QuickLink | null; pages: QuickLink[]; social: QuickLink[]; other: QuickLink[]; verify: QuickLink[] }

const PAGE_RULES: [string, RegExp][] = [
  ["Donate", /donat|\/give\b|contribut|support-us|\/support\b/i],
  ["Volunteer", /volunteer|get-involved|join-us/i],
  ["Contact", /contact|reach-us|get-in-touch/i],
  ["About / team", /about|who-we-are|our-team|\/team\b|board|trustee|leadership|governance/i],
  ["Reports", /report|annual|transparen|financial|audit|\.pdf$/i],
  ["Impact stories", /stor(y|ies)|impact|case-stud|testimonial/i],
  ["Programmes", /program|project|initiative|what-we-do|our-work/i],
  ["News / press", /news|press|media|blog|article/i],
  ["Events / campaigns", /event|campaign/i],
  ["Partners / CSR", /csr|partner|corporate/i],
  ["Careers", /career|jobs|vacanc/i],
  ["Privacy / terms", /privacy|terms|policy/i],
];

function pageLabel(url: string, title?: string): string {
  let path = "/";
  try { path = new URL(url).pathname; } catch { /* keep "/" */ }
  if (path === "/" || path === "") return "Home page";
  const hit = PAGE_RULES.find(([, re]) => re.test(path));
  if (hit) return hit[0];
  return (title?.split(/[|–—-]/)[0].trim() || path.replace(/\/$/, "").split("/").pop() || "Page").slice(0, 40);
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const PLATFORM: Record<string, string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", LINKEDIN: "LinkedIn", YOUTUBE: "YouTube", X: "X (Twitter)", OTHER: "Profile" };

/**
 * Everything the audit actually found online, as clickable links. Only pages that loaded successfully are listed
 * (a link that returned 404 is not "available"); social profiles not linked from the NGO's own site are marked unconfirmed.
 */
export function quickLinks(view: Pick<NgoView, "identity" | "social" | "evidence" | "ngo">): QuickLinkGroups {
  const site = view.identity?.officialWebsite ?? view.ngo.website ?? null;
  const siteHost = site ? host(site) : null;
  const seen = new Set<string>();
  const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "").toLowerCase();
  const take = (u: string) => { const k = norm(u); if (seen.has(k)) return false; seen.add(k); return true; };
  if (site) take(site);

  const pages: QuickLink[] = [];
  const other: QuickLink[] = [];
  const counts = new Map<string, number>();
  for (const e of view.evidence) {
    if (e.fetchStatus !== "OK" || !/^https?:\/\//i.test(e.url)) continue;
    const onSite = siteHost && host(e.url).endsWith(siteHost);
    if ((e.isOfficial || onSite) && e.sourceType !== "OFFICIAL_SOCIAL") {
      if (!take(e.url)) continue;
      let label = pageLabel(e.url, e.title);
      if (label === "Home page") continue;
      const n = (counts.get(label) ?? 0) + 1; counts.set(label, n);
      if (n > 1) label = `${label} ${n}`;
      pages.push({ label, url: e.url });
    } else if (!e.isOfficial && ["NEWS", "DIRECTORY", "GOVERNMENT_REGISTRY", "ANNUAL_REPORT", "OTHER", "SEARCH_RESULT"].includes(e.sourceType)) {
      if (!take(e.url)) continue;
      other.push({ label: (e.title || host(e.url)).slice(0, 70), url: e.url, note: host(e.url) });
    }
  }
  const social = view.social.filter((s) => s.url).map((s) => ({ label: PLATFORM[s.platform] ?? s.platform, url: s.url as string, note: s.isOfficial ? undefined : "unconfirmed" }));
  // One link per registry: 80G and 12A share the Income Tax portal, so they become "80G / 12A".
  const byUrl = new Map<string, { keys: string[]; name: string }>();
  for (const c of view.identity?.compliance ?? []) {
    if (!c.officialLookup?.url) continue;
    const cur = byUrl.get(c.officialLookup.url);
    if (cur) cur.keys.push(c.key); else byUrl.set(c.officialLookup.url, { keys: [c.key], name: c.officialLookup.name });
  }
  const verify = [...byUrl].map(([url, v]) => ({ label: `${v.keys.join(" / ")}: ${v.name}`, url }));
  const order = PAGE_RULES.map(([l]) => l);
  pages.sort((a, b) => (order.indexOf(a.label.replace(/ \d+$/, "")) + 100) % 100 - (order.indexOf(b.label.replace(/ \d+$/, "")) + 100) % 100);
  return { website: site ? { label: siteHost ?? site, url: site } : null, pages, social, other: other.slice(0, 12), verify };
}
