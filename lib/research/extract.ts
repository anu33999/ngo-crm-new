import * as cheerio from "cheerio";
import { cleanText } from "./text";

/** Facts extracted from one HTML page. Pure: html in, structured facts out. */
export interface PageFacts {
  url: string;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  lang: string | null;
  hreflangCount: number;
  viewport: string | null;
  h1s: string[];
  headingCounts: { h1: number; h2: number; h3: number };
  ogSiteName: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  hasOgImage: boolean;
  hasFavicon: boolean;
  jsonLdTypes: string[];
  images: { total: number; withoutAlt: number };
  forms: { fields: number; hasEmail: boolean; text: string; labelled: boolean }[];
  videoEmbeds: number;
  analytics: string[];
  paymentHints: string[];
  generator: string | null;
  links: { href: string; text: string; internal: boolean }[];
  socialLinks: string[];
  mailto: string[];
  tel: string[];
  keywordLinks: Record<LinkClass, { href: string; text: string }[]>;
  registrationMentions: Record<"80G" | "12A" | "FCRA" | "CSR-1" | "NGO Darpan", boolean>;
  scripts: string[]; // non-Latin scripts detected in visible text
  latestYear: number | null;
  textSample: string; // first ~1500 chars of visible text — untrusted content
  wordCount: number;
  navLinkCount: number;
}

export type LinkClass = "donate" | "volunteer" | "contact" | "reports" | "csr" | "impact" | "events" | "media" | "about" | "privacy" | "awards" | "newsletter";

const LINK_PATTERNS: Record<LinkClass, RegExp> = {
  donate: /\b(donate|donation|donations|contribute|contribution|give now|give today|support us|sponsor|fundrais\w*|crowdfund\w*)\b|[/-](donat|contribut|sponsor|fundrais|support-us|supportus|give)/i,
  volunteer: /\b(volunteer\w*|get involved|join us|internships?|become a (member|partner))\b|[/-](volunteer|get-involved|join-us|internship)/i,
  contact: /\b(contact|reach us|get in touch|write to us|enquir\w+|inquir\w+)\b|[/-](contact|enquiry|inquiry|reach-us)/i,
  reports: /\b(annual reports?|impact reports?|financials?|audited|audit report|transparency|csr report|publications?)\b|[/-](annual-report|impact-report|financial|audited|transparency|publications?)/i,
  csr: /\b(csr|corporate partner\w*|partner with us|corporate giving|corporate social)\b|[/-](csr|partner-with-us|corporate)/i,
  impact: /\b(impact|success stor\w+|stories|case stud\w+|testimonials?|our work|beneficiar\w+ stor\w+)\b|[/-](impact|stories|success-stor|case-stud|testimonial)/i,
  events: /\b(events?|campaigns?|walkathon|marathon|drive)\b|[/-](events?|campaigns?)/i,
  media: /\b(press|media|in the news|newsroom|news)\b|[/-](press|media|news)/i,
  about: /\b(about|who we are|our team|board|trustees|governance|leadership|our story)\b|[/-](about|team|board|trustees|governance|leadership)/i,
  privacy: /\b(privacy|data protection|terms (of use|and conditions)|cookie)\b|[/-](privacy|terms|cookie)/i,
  awards: /\b(awards?|recognition|accolades?|honou?rs?)\b|[/-](awards?|recognition)/i,
  newsletter: /\b(newsletter|subscribe|mailing list)\b|[/-](newsletter|subscribe)/i,
};

const ANALYTICS: [string, RegExp][] = [
  ["Google Analytics 4", /gtag\/js\?id=G-|["']G-[A-Z0-9]{6,}["']/],
  ["Google Tag Manager", /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/],
  ["Universal Analytics", /google-analytics\.com\/(analytics|ga)\.js|UA-\d{4,}-\d+/],
  ["Meta Pixel", /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(/],
  ["Hotjar", /static\.hotjar\.com|hotjar\.com/],
  ["Microsoft Clarity", /clarity\.ms/],
  ["Plausible", /plausible\.io\/js/],
  ["Matomo", /matomo|piwik/i],
];

const PAYMENT: [string, RegExp][] = [
  ["Razorpay", /razorpay/i], ["PayU", /payu(money|biz)?\b/i], ["PayPal", /paypal/i], ["Stripe", /stripe\.com|js\.stripe/i],
  ["CCAvenue", /ccavenue/i], ["Instamojo", /instamojo/i], ["Cashfree", /cashfree/i], ["BillDesk", /billdesk/i],
  ["Paytm", /paytm/i], ["PhonePe", /phonepe/i], ["UPI", /upi:\/\/|\bupi id\b/i], ["Donorbox", /donorbox/i],
  ["Zeffy", /zeffy/i], ["Ketto", /ketto\.org/i], ["Milaap", /milaap\.org/i], ["GiveIndia", /giveindia\.org/i],
];

const SCRIPT_RANGES: [string, RegExp][] = [
  ["Devanagari", /[ऀ-ॿ]/], ["Bengali", /[ঀ-৿]/], ["Gurmukhi", /[਀-੿]/], ["Gujarati", /[઀-૿]/],
  ["Odia", /[଀-୿]/], ["Tamil", /[஀-௿]/], ["Telugu", /[ఀ-౿]/], ["Kannada", /[ಀ-೿]/], ["Malayalam", /[ഀ-ൿ]/],
];

const SOCIAL_HOST = /(^|\.)(instagram\.com|facebook\.com|fb\.com|linkedin\.com|youtube\.com|x\.com|twitter\.com|threads\.net)$/;

function abs(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function extractPage(html: string, url: string): PageFacts {
  const $ = cheerio.load(html);
  const baseHost = new URL(url).hostname.replace(/^www\./, "");
  const meta = (sel: string) => $(sel).attr("content")?.trim() || null;

  // Strip non-content before reading visible text.
  const $text = cheerio.load(html);
  $text("script, style, noscript, template, svg, iframe").remove();
  const visible = cleanText($text("body").text(), 60000);
  const words = visible ? visible.split(/\s+/).length : 0;

  const links: PageFacts["links"] = [];
  const keywordLinks = Object.fromEntries((Object.keys(LINK_PATTERNS) as LinkClass[]).map((k) => [k, [] as { href: string; text: string }[]])) as PageFacts["keywordLinks"];
  const social = new Set<string>();
  const mailto = new Set<string>();
  const tel = new Set<string>();

  $("a[href]").each((_, el) => {
    const raw = ($(el).attr("href") ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return;
    if (raw.startsWith("mailto:")) return void mailto.add(raw.slice(7).split("?")[0].toLowerCase());
    if (raw.startsWith("tel:")) return void tel.add(raw.slice(4));
    const href = abs(raw, url);
    if (!href) return;
    const text = cleanText($(el).text() || $(el).attr("aria-label") || $(el).attr("title") || "", 120);
    const host = new URL(href).hostname.replace(/^www\./, "");
    const internal = host === baseHost || host.endsWith(`.${baseHost}`);
    if (SOCIAL_HOST.test(host)) social.add(href);
    if (links.length < 400) links.push({ href, text, internal });
    for (const cls of Object.keys(LINK_PATTERNS) as LinkClass[]) {
      if (cls === "newsletter") continue;
      const path = internal ? new URL(href).pathname : "";
      if ((LINK_PATTERNS[cls].test(text) || (internal && LINK_PATTERNS[cls].test(path))) && keywordLinks[cls].length < 8) {
        if (!keywordLinks[cls].some((l) => l.href === href)) keywordLinks[cls].push({ href, text });
      }
    }
    // PDF report links
    if (/\.pdf($|\?)/i.test(href) && LINK_PATTERNS.reports.test(`${text} ${href}`) && !keywordLinks.reports.some((l) => l.href === href)) keywordLinks.reports.push({ href, text });
  });

  const forms: PageFacts["forms"] = [];
  $("form").each((_, el) => {
    const f = $(el);
    const inputs = f.find("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select");
    const labelled = inputs.toArray().every((i) => {
      const id = $(i).attr("id");
      return !!($(i).attr("aria-label") || $(i).attr("placeholder") || $(i).attr("title") || (id && $(`label[for="${id}"]`).length) || $(i).closest("label").length);
    });
    forms.push({ fields: inputs.length, hasEmail: f.find("input[type=email], input[name*=email i]").length > 0, text: cleanText(f.text(), 200), labelled });
  });
  if (forms.some((f) => f.hasEmail && /subscribe|newsletter|sign up|stay (updated|in touch)|updates/i.test(f.text))) {
    keywordLinks.newsletter.push({ href: url, text: "newsletter signup form" });
  } else {
    for (const l of links) if (LINK_PATTERNS.newsletter.test(l.text) && keywordLinks.newsletter.length < 3) keywordLinks.newsletter.push({ href: l.href, text: l.text });
  }

  const jsonLdTypes: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const walk = (n: unknown) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === "object") {
          const o = n as Record<string, unknown>;
          const t = o["@type"];
          if (typeof t === "string") jsonLdTypes.push(t);
          else if (Array.isArray(t)) jsonLdTypes.push(...t.filter((x): x is string => typeof x === "string"));
          if (o["@graph"]) walk(o["@graph"]);
        }
      };
      walk(data);
    } catch {
      /* malformed JSON-LD: ignore */
    }
  });

  const imgs = $("img");
  let withoutAlt = 0;
  imgs.each((_, el) => {
    const alt = $(el).attr("alt");
    if (alt === undefined || alt.trim() === "") {
      // decorative images may legitimately carry role="presentation" / aria-hidden
      if ($(el).attr("role") !== "presentation" && $(el).attr("aria-hidden") !== "true") withoutAlt++;
    }
  });

  const haystack = html;
  const years = [...visible.matchAll(/\b(20[0-3]\d)\b/g)].map((m) => Number(m[1])).filter((y) => y <= new Date().getFullYear() + 1);
  const timeYears = $("time[datetime]").toArray().map((el) => Number(($(el).attr("datetime") ?? "").slice(0, 4))).filter((y) => y > 1999);
  const allYears = [...years, ...timeYears];

  return {
    url,
    title: cleanText($("title").first().text(), 300) || null,
    metaDescription: meta('meta[name="description" i]'),
    canonical: $('link[rel="canonical"]').attr("href")?.trim() || null,
    robotsMeta: meta('meta[name="robots" i]'),
    lang: $("html").attr("lang")?.trim() || null,
    hreflangCount: $("link[hreflang]").length,
    viewport: meta('meta[name="viewport" i]'),
    h1s: $("h1").toArray().map((e) => cleanText($(e).text(), 160)).filter(Boolean),
    headingCounts: { h1: $("h1").length, h2: $("h2").length, h3: $("h3").length },
    ogSiteName: meta('meta[property="og:site_name"]'),
    ogTitle: meta('meta[property="og:title"]'),
    ogDescription: meta('meta[property="og:description"]'),
    hasOgImage: !!meta('meta[property="og:image"]'),
    hasFavicon: $('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').length > 0,
    jsonLdTypes: [...new Set(jsonLdTypes)],
    images: { total: imgs.length, withoutAlt },
    forms,
    videoEmbeds: $('iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="vimeo"], video').length,
    analytics: ANALYTICS.filter(([, re]) => re.test(haystack)).map(([n]) => n),
    paymentHints: PAYMENT.filter(([, re]) => re.test(haystack)).map(([n]) => n),
    generator: meta('meta[name="generator" i]'),
    links,
    socialLinks: [...social],
    mailto: [...mailto],
    tel: [...tel],
    keywordLinks,
    registrationMentions: {
      "80G": /\b80\s?G\b/i.test(visible),
      "12A": /\b12\s?A[AB]?\b/i.test(visible),
      FCRA: /\bFCRA\b/i.test(visible),
      "CSR-1": /\bCSR[\s-]?1\b/i.test(visible),
      "NGO Darpan": /\b(ngo\s+)?darpan\b/i.test(visible),
    },
    scripts: SCRIPT_RANGES.filter(([, re]) => re.test(visible)).map(([n]) => n),
    latestYear: allYears.length ? Math.max(...allYears) : null,
    textSample: visible.slice(0, 1500),
    wordCount: words,
    navLinkCount: $("nav a, header a").length,
  };
}
