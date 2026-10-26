import { extractPage } from "@/lib/research/extract";
import type { FetchedPage, SiteSnapshot } from "@/lib/research/audit";

export const SITE = "https://ashakiranfoundation.org";
export const CHECKED_AT = "2026-10-20T10:00:00.000Z";

export function snapshotFrom(html: string | null, o: Partial<SiteSnapshot> & { donateHtml?: string; pages?: FetchedPage[] } = {}): SiteSnapshot {
  const homeFacts = html ? extractPage(html, `${SITE}/`) : null;
  const pages = o.pages ?? [];
  if (o.donateHtml) {
    pages.push({ role: "donate", url: `${SITE}/donate`, linkedFrom: SITE, fetch: { status: "OK", httpStatus: 200 }, facts: extractPage(o.donateHtml, `${SITE}/donate`) });
  }
  return {
    siteUrl: SITE,
    checkedAt: CHECKED_AT,
    homepage: homeFacts ? { status: "OK", httpStatus: 200, ms: 320, finalUrl: `${SITE}/` } : { status: "FAILED", error: "ECONNREFUSED" },
    homeFacts,
    pages,
    robots: { found: false, sitemaps: [] },
    sitemap: null,
    pagespeed: { unavailable: "PAGESPEED_API_KEY is not configured." },
    ...o,
  };
}
