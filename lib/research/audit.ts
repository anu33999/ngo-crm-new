import type { FetchStatusKind } from "./fetcher";
import type { LinkClass, PageFacts } from "./extract";
import type { Assessment, Confidence, FindingDraft, FrameworkAreaId, GapState, Priority } from "./types";
import { FRAMEWORK_BY_ID } from "./framework";

/**
 * Rules-based website audit. Pure: a SiteSnapshot in, FindingDrafts out.
 *
 * Wording rules enforced here (and tested):
 *  - "not found" findings always say what was checked and never claim the thing does not exist;
 *  - CONFIRMED_ISSUE is used only where we directly observed the problem in the HTML or a tested request;
 *  - behaviour we did not exercise (payments, forms, mobile rendering) is reported as untested;
 *  - CRITICAL is reserved for evidenced, genuinely significant problems.
 */

export interface FetchSummary {
  status: FetchStatusKind;
  httpStatus?: number;
  ms?: number;
  error?: string;
  finalUrl?: string;
}

export type PageRole = "donate" | "volunteer" | "contact" | "about" | "reports" | "impact" | "csr" | "media" | "events" | "privacy";

export interface FetchedPage {
  role: PageRole;
  url: string;
  linkedFrom: string;
  fetch: FetchSummary;
  facts?: PageFacts;
}

export interface PageSpeedResult {
  performance: number | null; // 0..100
  lcpMs?: number | null;
  cls?: number | null;
  strategy: "mobile";
  url: string;
}

export interface SiteSnapshot {
  siteUrl: string;
  checkedAt: string;
  homepage: FetchSummary;
  homeFacts: PageFacts | null;
  pages: FetchedPage[];
  robots: { found: boolean; sitemaps: string[]; blockedReason?: string };
  sitemap: { url: string; found: boolean; urlCount?: number } | null;
  pagespeed: PageSpeedResult | { unavailable: string };
}

type Draft = Omit<FindingDraft, "checkedAt" | "section" | "category" | "mayAddressOffline"> &
  Partial<Pick<FindingDraft, "section" | "category" | "mayAddressOffline">>;

function build(snapshot: SiteSnapshot, d: Draft): FindingDraft {
  const area = FRAMEWORK_BY_ID[d.areaId];
  return {
    section: "GAP",
    category: area.category,
    mayAddressOffline: area.oftenOffline,
    whyItMatters: area.whyItMatters,
    consequence: area.consequence,
    ...d,
    checkedAt: snapshot.checkedAt,
  };
}

const exists = (
  s: SiteSnapshot,
  key: string,
  areaId: FrameworkAreaId,
  title: string,
  observation: string,
  evidenceUrls: string[],
  assessment: Assessment = "ADEQUATE",
  confidence: Confidence = "HIGH",
  pageUrl?: string,
): FindingDraft =>
  build(s, {
    key, areaId, title, observation, evidenceUrls, assessment, confidence, pageUrl,
    section: "EXISTING",
  });

const gap = (
  s: SiteSnapshot,
  key: string,
  areaId: FrameworkAreaId,
  gapState: GapState,
  title: string,
  observation: string,
  evidenceUrls: string[],
  o: { confidence: Confidence; priority?: Priority; recommendedAction?: string; pageUrl?: string; assessment?: Assessment },
): FindingDraft =>
  build(s, {
    key, areaId, title, observation, evidenceUrls, gapState,
    section: "GAP",
    assessment: o.assessment ?? (gapState === "UNABLE_TO_ASSESS" || gapState === "NOT_FOUND_PUBLICLY" ? "UNKNOWN" : "NEEDS_IMPROVEMENT"),
    confidence: o.confidence,
    priority: gapState === "UNABLE_TO_ASSESS" ? undefined : o.priority,
    recommendedAction: o.recommendedAction,
    pageUrl: o.pageUrl,
  });

const ROLE_LABEL: Record<PageRole, string> = {
  donate: "donation", volunteer: "volunteer", contact: "contact", about: "about/governance", reports: "reports",
  impact: "impact stories", csr: "CSR/partnership", media: "media/press", events: "events/campaigns", privacy: "privacy policy",
};

export function auditSite(s: SiteSnapshot): FindingDraft[] {
  const out: FindingDraft[] = [];
  const home = s.homeFacts;
  const homeUrl = s.siteUrl;

  // ── reachability ──────────────────────────────────────────────────────────
  if (!home) {
    const st = s.homepage.status;
    const why =
      st === "BLOCKED_BY_ROBOTS"
        ? "The site's robots.txt does not allow automated access to the homepage, so no audit was performed (this is not evidence of a problem)."
        : st === "REQUIRES_LOGIN"
          ? "The homepage requires a login, so it could not be audited."
          : `The homepage could not be retrieved (${s.homepage.error ?? st}). The site may be down, slow, or blocking automated requests; retry before drawing conclusions.`;
    out.push(gap(s, "site.reachable", "website-ux", "UNABLE_TO_ASSESS", "Website could not be audited", why, [homeUrl], { confidence: "HIGH" }));
    return out;
  }

  out.push(exists(s, "site.reachable", "website-ux", "Website responds", `The homepage was retrieved (HTTP ${s.homepage.httpStatus ?? 200}${s.homepage.ms ? `, ${s.homepage.ms} ms for one request` : ""}).`, [homeUrl]));

  // ── HTTPS ─────────────────────────────────────────────────────────────────
  const https = (s.homepage.finalUrl ?? homeUrl).startsWith("https://");
  const hasFormWithFields = [home, ...s.pages.map((p) => p.facts).filter(Boolean) as PageFacts[]].some((f) => f.forms.some((x) => x.fields > 0));
  if (https) {
    out.push(exists(s, "site.https", "website-ux", "HTTPS in use", "The homepage was served over HTTPS.", [homeUrl]));
  } else {
    out.push(gap(s, "site.https", "website-ux", "CONFIRMED_ISSUE", "Website served over unencrypted HTTP",
      `The homepage was served over plain HTTP${hasFormWithFields ? " and the pages checked include forms" : ""}. Browsers label such pages “Not secure”.`,
      [homeUrl], { confidence: "HIGH", priority: hasFormWithFields ? "CRITICAL" : "HIGH", recommendedAction: "Install a TLS certificate and redirect all HTTP traffic to HTTPS." }));
  }

  // ── mobile / accessibility signals ────────────────────────────────────────
  if (home.viewport) {
    out.push(exists(s, "site.viewport", "accessibility-mobile", "Mobile viewport configured", "A viewport meta tag is present. Actual mobile rendering was not tested.", [homeUrl], "ADEQUATE", "MEDIUM"));
  } else {
    out.push(gap(s, "site.viewport", "accessibility-mobile", "LIKELY_OPPORTUNITY", "No mobile viewport tag found",
      "No viewport meta tag was found in the homepage HTML, which usually means pages do not adapt to phone screens. Mobile rendering was not tested directly.",
      [homeUrl], { confidence: "MEDIUM", priority: "HIGH", recommendedAction: "Confirm on a phone; if the layout does not adapt, a responsive template is needed." }));
  }

  const imgs = [home, ...s.pages.map((p) => p.facts).filter(Boolean) as PageFacts[]].reduce((a, f) => ({ total: a.total + f.images.total, noAlt: a.noAlt + f.images.withoutAlt }), { total: 0, noAlt: 0 });
  if (imgs.total >= 5 && imgs.noAlt / imgs.total >= 0.3) {
    out.push(gap(s, "site.alt", "accessibility-mobile", "CONFIRMED_ISSUE", "Many images lack alternative text",
      `${imgs.noAlt} of ${imgs.total} images on the pages checked have no alt text, which affects screen-reader users and image search.`,
      [homeUrl], { confidence: "HIGH", priority: "MEDIUM", recommendedAction: "Add descriptive alt text to meaningful images." }));
  } else if (imgs.total > 0) {
    out.push(exists(s, "site.alt", "accessibility-mobile", "Image alt text mostly present", `${imgs.total - imgs.noAlt} of ${imgs.total} images on the pages checked have alt text.`, [homeUrl]));
  }

  const unlabelled = [home, ...s.pages.map((p) => p.facts).filter(Boolean) as PageFacts[]].filter((f) => f.forms.some((x) => x.fields > 0 && !x.labelled));
  if (unlabelled.length) {
    out.push(gap(s, "site.form-labels", "accessibility-mobile", "CONFIRMED_ISSUE", "Form fields without labels or placeholders",
      `${unlabelled.length} page(s) contain form fields with no label, placeholder or aria-label, which makes forms harder to use with assistive technology.`,
      unlabelled.map((f) => f.url), { confidence: "HIGH", priority: "MEDIUM", pageUrl: unlabelled[0].url, recommendedAction: "Label every form field." }));
  }
  if (!home.lang) {
    out.push(gap(s, "site.lang", "accessibility-mobile", "CONFIRMED_ISSUE", "Page language not declared", "The <html> element has no lang attribute.", [homeUrl], { confidence: "HIGH", priority: "LOW" }));
  }

  // ── on-page SEO ───────────────────────────────────────────────────────────
  const seoIssues: string[] = [];
  if (!home.title) seoIssues.push("no <title>");
  else if (home.title.length < 15 || home.title.length > 70) seoIssues.push(`title length ${home.title.length} (typical target 15–70)`);
  if (!home.metaDescription) seoIssues.push("no meta description");
  else if (home.metaDescription.length < 50 || home.metaDescription.length > 170) seoIssues.push(`meta description length ${home.metaDescription.length} (typical target 50–170)`);
  if (home.headingCounts.h1 === 0) seoIssues.push("no H1 heading");
  if (home.headingCounts.h1 > 1) seoIssues.push(`${home.headingCounts.h1} H1 headings`);

  const direct = !home.title || !home.metaDescription || home.headingCounts.h1 === 0;
  if (seoIssues.length) {
    out.push(gap(s, "seo.basics", "search-seo", direct ? "CONFIRMED_ISSUE" : "LIKELY_OPPORTUNITY", "Homepage on-page SEO basics need attention",
      `Observed in the homepage HTML: ${seoIssues.join("; ")}. This inspects the page's SEO implementation; it is not a measurement of Google rankings.`,
      [homeUrl], { confidence: "HIGH", priority: "MEDIUM", recommendedAction: "Write a unique title and meta description and a single clear H1 for the homepage and key pages." }));
  } else {
    out.push(exists(s, "seo.basics", "search-seo", "Homepage title, description and H1 present", `Title (“${home.title}”), meta description and a single H1 are present.`, [homeUrl]));
  }
  if (!home.canonical) out.push(gap(s, "seo.canonical", "search-seo", "LIKELY_OPPORTUNITY", "No canonical tag on the homepage", "No rel=canonical link was found; duplicate URL variants may compete in search.", [homeUrl], { confidence: "MEDIUM", priority: "LOW" }));
  if (home.jsonLdTypes.length === 0) {
    out.push(gap(s, "seo.structured-data", "search-seo", "LIKELY_OPPORTUNITY", "No structured data found", "No JSON-LD structured data was found on the homepage. Organization/NGO schema helps search engines show accurate details.", [homeUrl], { confidence: "MEDIUM", priority: "LOW", recommendedAction: "Add Organization / NGO schema markup." }));
  } else {
    out.push(exists(s, "seo.structured-data", "search-seo", "Structured data present", `JSON-LD types found: ${home.jsonLdTypes.join(", ")}.`, [homeUrl]));
  }
  if (s.sitemap?.found) {
    out.push(exists(s, "seo.sitemap", "search-seo", "XML sitemap available", `A sitemap was found at ${s.sitemap.url}${s.sitemap.urlCount ? ` listing about ${s.sitemap.urlCount} URLs` : ""}.`, [s.sitemap.url]));
  } else {
    out.push(gap(s, "seo.sitemap", "search-seo", "NOT_FOUND_PUBLICLY", "No sitemap found in the locations checked", `No XML sitemap was found at /sitemap.xml or listed in robots.txt${s.robots.found ? "" : " (no robots.txt was found either)"}. It may exist at another address.`, [homeUrl], { confidence: "MEDIUM", priority: "LOW" }));
  }

  // ── performance (measured only if PageSpeed Insights is configured) ───────
  if ("unavailable" in s.pagespeed) {
    out.push(gap(s, "site.perf", "accessibility-mobile", "UNABLE_TO_ASSESS", "Performance / Core Web Vitals not measured",
      `${s.pagespeed.unavailable} The homepage HTML took ${s.homepage.ms ?? "unknown"} ms for a single request, which is not a Core Web Vitals measurement.`, [homeUrl], { confidence: "HIGH" }));
  } else {
    const p = s.pagespeed;
    const score = p.performance;
    if (score === null) {
      out.push(gap(s, "site.perf", "accessibility-mobile", "UNABLE_TO_ASSESS", "PageSpeed returned no performance score", "PageSpeed Insights did not return a performance score for the homepage.", [homeUrl], { confidence: "HIGH" }));
    } else if (score < 50) {
      out.push(gap(s, "site.perf", "accessibility-mobile", "CONFIRMED_ISSUE", `Slow on mobile (PageSpeed ${score}/100)`, `PageSpeed Insights (mobile, lab data) scored the homepage ${score}/100${p.lcpMs ? `, largest contentful paint ${(p.lcpMs / 1000).toFixed(1)} s` : ""}.`, [p.url], { confidence: "HIGH", priority: "MEDIUM", recommendedAction: "Compress images, defer scripts and review hosting." }));
    } else if (score < 90) {
      out.push(gap(s, "site.perf", "accessibility-mobile", "LIKELY_OPPORTUNITY", `Mobile performance could improve (PageSpeed ${score}/100)`, `PageSpeed Insights (mobile, lab data) scored the homepage ${score}/100.`, [p.url], { confidence: "HIGH", priority: "LOW" }));
    } else {
      out.push(exists(s, "site.perf", "accessibility-mobile", `Strong mobile performance (PageSpeed ${score}/100)`, `PageSpeed Insights (mobile, lab data) scored the homepage ${score}/100.`, [p.url], "STRONG"));
    }
  }

  // ── analytics ─────────────────────────────────────────────────────────────
  if (home.analytics.length) {
    out.push(exists(s, "site.analytics", "analytics", "Analytics tooling detected", `Detected in the homepage HTML: ${home.analytics.join(", ")}.`, [homeUrl]));
  } else {
    out.push(gap(s, "site.analytics", "analytics", "LIKELY_OPPORTUNITY", "No analytics tag detected in page HTML", "No Google Analytics, Tag Manager, Meta Pixel or similar tag was found in the homepage HTML. Tags that load only after cookie consent or via scripts may not be visible to this check.", [homeUrl], { confidence: "LOW", priority: "MEDIUM", recommendedAction: "Confirm with the team whether analytics is set up; if not, set up GA4 with donation/volunteer conversion tracking." }));
  }

  // ── broken links on the pages we actually tested ─────────────────────────
  for (const p of s.pages) {
    if (p.fetch.httpStatus === 404 || p.fetch.httpStatus === 410) {
      out.push(gap(s, `site.broken.${p.role}`, p.role === "donate" ? "donation" : p.role === "volunteer" ? "volunteer" : "website-ux", "CONFIRMED_ISSUE",
        `Linked ${ROLE_LABEL[p.role]} page returns ${p.fetch.httpStatus}`,
        `The link “${p.url}” (found on ${p.linkedFrom}) returned HTTP ${p.fetch.httpStatus} when requested.`, [p.url, p.linkedFrom],
        { confidence: "HIGH", priority: p.role === "donate" || p.role === "volunteer" ? "HIGH" : "MEDIUM", pageUrl: p.linkedFrom, recommendedAction: "Fix or redirect the broken link." }));
    }
  }

  // ── conversion journeys ───────────────────────────────────────────────────
  const checkedPages = 1 + s.pages.filter((p) => p.facts).length;
  const checkedNote = `${checkedPages} page${checkedPages === 1 ? "" : "s"} checked`;
  const classLinks = (cls: LinkClass) => {
    const seen = new Map<string, { href: string; text: string }>();
    for (const f of [home, ...s.pages.map((p) => p.facts).filter(Boolean) as PageFacts[]]) for (const l of f.keywordLinks[cls]) seen.set(l.href, l);
    return [...seen.values()];
  };
  const pageByRole = (r: PageRole) => s.pages.find((p) => p.role === r);

  const journey = (role: "donate" | "volunteer", area: FrameworkAreaId, label: string, extra: (page?: FetchedPage) => string) => {
    const links = classLinks(role);
    const page = pageByRole(role);
    if (!links.length && !page) {
      out.push(gap(s, `journey.${role}`, area, "NOT_FOUND_PUBLICLY", `No ${label} page found in the sources checked`,
        `No ${label} page or link was found (${checkedNote}: homepage navigation and linked pages). It may exist elsewhere, load via JavaScript, sit on another domain, or be handled offline.`,
        [homeUrl], { confidence: "MEDIUM", priority: role === "donate" ? "HIGH" : "MEDIUM", recommendedAction: `Confirm with the NGO how ${label}s are taken today; if there is no online path, add a clear ${label} page linked from the main navigation.` }));
      return;
    }
    const url = page?.url ?? links[0].href;
    if (page && (page.fetch.httpStatus === 404 || page.fetch.httpStatus === 410)) return; // reported as broken link above
    if (page && page.fetch.status !== "OK") {
      out.push(gap(s, `journey.${role}`, area, "UNABLE_TO_ASSESS", `${label[0].toUpperCase()}${label.slice(1)} page could not be inspected`,
        `A ${label} link exists (${url}) but the page could not be retrieved (${page.fetch.error ?? page.fetch.status}).`, [url, homeUrl], { confidence: "HIGH", pageUrl: url }));
      return;
    }
    out.push(exists(s, `journey.${role}`, area, `${label[0].toUpperCase()}${label.slice(1)} path found`, `A ${label} link/page exists (“${links[0]?.text || url}”). ${extra(page)}`, [url, homeUrl], "ADEQUATE", "HIGH", url));
  };

  journey("donate", "donation", "donation", (page) => {
    const hints = [...new Set([...(home.paymentHints), ...(page?.facts?.paymentHints ?? [])])];
    const recurring = /\b(monthly|recurring|every month|standing instruction|sip)\b/i.test(page?.facts?.textSample ?? "");
    return `${hints.length ? `Payment provider references seen in page markup: ${hints.join(", ")}.` : "No payment provider was identified in the page markup (it may be embedded or hosted elsewhere)."} ${recurring ? "Recurring giving is mentioned." : "A recurring-giving option was not evident in the text reviewed."} The payment flow itself was not tested.`;
  });
  journey("volunteer", "volunteer", "volunteer", (page) => (page?.facts?.forms.length ? "The page contains a form. Submission was not tested." : "No form was found on the page (sign-up may be by email or an external form)."));

  const contactLinks = classLinks("contact");
  if (home.mailto.length || home.tel.length || home.forms.length || contactLinks.length || pageByRole("contact")?.facts) {
    out.push(exists(s, "journey.contact", "website-ux", "Contact route available", `Contact options found: ${[home.mailto.length && "email address", home.tel.length && "phone number", (home.forms.length || pageByRole("contact")?.facts?.forms.length) && "form", contactLinks.length && "contact page link"].filter(Boolean).join(", ")}.`, [homeUrl]));
  } else {
    out.push(gap(s, "journey.contact", "website-ux", "NOT_FOUND_PUBLICLY", "No contact route found in the sources checked", `No email, phone, form or contact-page link was found on the pages checked (${checkedNote}).`, [homeUrl], { confidence: "MEDIUM", priority: "MEDIUM" }));
  }

  if (classLinks("newsletter").length) {
    out.push(exists(s, "journey.newsletter", "donor-crm", "Newsletter / subscription point found", "A newsletter or subscribe form/link was found.", [homeUrl], "ADEQUATE", "MEDIUM"));
  } else {
    out.push(gap(s, "journey.newsletter", "donor-crm", "NOT_FOUND_PUBLICLY", "No newsletter sign-up found in the sources checked", `No subscribe form or newsletter link was found (${checkedNote}).`, [homeUrl], { confidence: "MEDIUM", priority: "LOW" }));
  }

  // ── content & trust ───────────────────────────────────────────────────────
  const reports = classLinks("reports");
  const pdfReports = reports.filter((r) => /\.pdf($|\?)/i.test(r.href));
  if (reports.length) {
    out.push(exists(s, "content.reports", "annual-report-design", "Reports / transparency content found", `${reports.length} report-related link(s) found${pdfReports.length ? `, ${pdfReports.length} PDF` : ""}: ${reports.slice(0, 3).map((r) => `“${r.text || r.href}”`).join(", ")}. Report quality and currency were not assessed.`, [homeUrl, ...reports.slice(0, 2).map((r) => r.href)]));
  } else {
    out.push(gap(s, "content.reports", "annual-report-design", "NOT_FOUND_PUBLICLY", "No annual or impact report found in the sources checked", `No link to an annual report, impact report or audited financials was found (${checkedNote}). Reports may be shared privately with funders or hosted elsewhere.`, [homeUrl], { confidence: "MEDIUM", priority: "MEDIUM", recommendedAction: "Ask whether a current report exists; if so, publish a summary page and downloadable PDF." }));
  }

  const keyed: [LinkClass, FrameworkAreaId, string, string, Priority][] = [
    ["impact", "storytelling", "Impact stories / case studies", "impact stories or case studies", "MEDIUM"],
    ["csr", "csr", "CSR / corporate partnership content", "a CSR or corporate-partnership page", "MEDIUM"],
    ["media", "pr-media", "Press / media section", "a press or media section", "LOW"],
    ["events", "events-campaigns", "Events / campaigns content", "events or campaigns content", "LOW"],
  ];
  for (const [cls, area, ok, missing, prio] of keyed) {
    const links = classLinks(cls);
    if (links.length) out.push(exists(s, `content.${cls}`, area, `${ok} found`, `Found: ${links.slice(0, 3).map((l) => `“${l.text || l.href}”`).join(", ")}. Depth and freshness were not assessed.`, [homeUrl, links[0].href], "ADEQUATE", "MEDIUM"));
    else out.push(gap(s, `content.${cls}`, area, "NOT_FOUND_PUBLICLY", `No ${ok.toLowerCase()} found in the sources checked`, `No link to ${missing} was found (${checkedNote}). It may exist under a different name or off-site.`, [homeUrl], { confidence: "LOW", priority: prio }));
  }
  if (classLinks("awards").length) out.push(exists(s, "content.awards", "grants-awards", "Awards / recognition content found", "A page or link about awards or recognition was found.", [homeUrl], "ADEQUATE", "MEDIUM"));

  const aboutLinks = classLinks("about");
  const governance = /\b(trustees?|board|governance|leadership|our team)\b/i.test(aboutLinks.map((l) => l.text + l.href).join(" "));
  if (governance) out.push(exists(s, "trust.governance", "credibility", "Leadership / governance information linked", "Links to team, board or governance information were found.", [homeUrl], "ADEQUATE", "MEDIUM"));
  else out.push(gap(s, "trust.governance", "credibility", "NOT_FOUND_PUBLICLY", "No leadership or governance page found in the sources checked", `No link to a team, board or trustee page was found (${checkedNote}).`, [homeUrl], { confidence: "LOW", priority: "MEDIUM" }));

  const videoCount = [home, ...s.pages.map((p) => p.facts).filter(Boolean) as PageFacts[]].reduce((n, f) => n + f.videoEmbeds, 0);
  if (videoCount) out.push(exists(s, "content.video", "media-content", "Video content embedded", `${videoCount} video embed(s) found on the pages checked.`, [homeUrl], "ADEQUATE", "MEDIUM"));
  else out.push(gap(s, "content.video", "media-content", "NOT_FOUND_PUBLICLY", "No embedded video found on the pages checked", `No video embeds were found (${checkedNote}). Videos may live on social channels instead.`, [homeUrl], { confidence: "LOW", priority: "LOW" }));

  const mentions = (["80G", "12A", "FCRA", "CSR-1", "NGO Darpan"] as const).filter((k) => [home, ...s.pages.map((p) => p.facts).filter(Boolean) as PageFacts[]].some((f) => f.registrationMentions[k]));
  if (mentions.length) {
    out.push(exists(s, "trust.registration-claims", "credibility", "Registrations mentioned on the website", `The website mentions: ${mentions.join(", ")}. These are the NGO's own statements and have not been verified against government registries.`, [homeUrl], "ADEQUATE", "MEDIUM"));
  } else {
    out.push(gap(s, "trust.registration-claims", "credibility", "NOT_FOUND_PUBLICLY", "No registration details found on the website", `No mention of 80G, 12A, FCRA, CSR-1 or NGO Darpan was found on the pages checked (${checkedNote}). This does not mean the NGO lacks these registrations; they may be displayed elsewhere.`, [homeUrl], { confidence: "MEDIUM", priority: "MEDIUM", recommendedAction: "Display registration numbers and certificates on a transparency page." }));
  }

  if (classLinks("privacy").length) {
    out.push(exists(s, "trust.privacy", "privacy-consent", "Privacy / terms link found", "A privacy policy or terms link was found.", [homeUrl], "ADEQUATE", "MEDIUM"));
  } else if (hasFormWithFields) {
    out.push(gap(s, "trust.privacy", "privacy-consent", "LIKELY_OPPORTUNITY", "No privacy policy link found next to data-collecting forms", `Forms were found but no privacy policy link was found on the pages checked (${checkedNote}).`, [homeUrl], { confidence: "MEDIUM", priority: "MEDIUM", recommendedAction: "Publish a plain-language privacy and consent notice and link it from every form." }));
  } else {
    out.push(gap(s, "trust.privacy", "privacy-consent", "NOT_FOUND_PUBLICLY", "No privacy policy found in the sources checked", `No privacy policy link was found (${checkedNote}).`, [homeUrl], { confidence: "LOW", priority: "LOW" }));
  }

  // ── language ──────────────────────────────────────────────────────────────
  const scripts = [...new Set([home, ...s.pages.map((p) => p.facts).filter(Boolean) as PageFacts[]].flatMap((f) => f.scripts))];
  if (scripts.length || home.hreflangCount > 0) {
    out.push(exists(s, "lang.regional", "regional-language", "Regional-language content detected", `${scripts.length ? `Non-Latin script text detected: ${scripts.join(", ")}.` : ""} ${home.hreflangCount ? `${home.hreflangCount} language alternate link(s).` : ""}`.trim(), [homeUrl], "ADEQUATE", "MEDIUM"));
  } else {
    out.push(gap(s, "lang.regional", "regional-language", "NOT_FOUND_PUBLICLY", "No regional-language content found on the pages checked", `Only Latin-script text was detected (${checkedNote}) and no language alternates were declared. Regional-language material may be published elsewhere.`, [homeUrl], { confidence: "LOW", priority: "LOW" }));
  }

  // ── freshness & brand signals ─────────────────────────────────────────────
  const year = new Date(s.checkedAt).getFullYear();
  if (home.latestYear !== null && home.latestYear <= year - 2) {
    out.push(gap(s, "site.freshness", "storytelling", "LIKELY_OPPORTUNITY", "Website content may be out of date", `The most recent year mentioned in the homepage text or dated elements is ${home.latestYear}. Newer updates may be published elsewhere.`, [homeUrl], { confidence: "LOW", priority: "MEDIUM", recommendedAction: "Review recent activity and refresh the homepage with current programmes and results." }));
  } else if (home.latestYear !== null) {
    out.push(exists(s, "site.freshness", "storytelling", "Recent dates on the homepage", `The most recent year mentioned on the homepage is ${home.latestYear}.`, [homeUrl], "ADEQUATE", "LOW"));
  }
  if (!home.hasFavicon && !home.hasOgImage) {
    out.push(gap(s, "brand.share-assets", "brand", "LIKELY_OPPORTUNITY", "No favicon or social-share image defined", "Neither a favicon nor an Open Graph share image was found, so links shared on social media and browser tabs may look unbranded.", [homeUrl], { confidence: "MEDIUM", priority: "LOW", recommendedAction: "Add a favicon and a branded share image." }));
  }

  return out;
}
