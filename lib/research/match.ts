import type { Catalogue, Eligibility, Tier } from "@/lib/catalogue";
import type { AreaAssessment, RankedOpportunity } from "./gaps";
import type { Confidence, FrameworkAreaId, GapState, Priority } from "./types";

/**
 * Rules-based service matching. The rules say *which catalogue service answers which gap*; the
 * evidence state decides *whether* and *how confidently* it is recommended. Services are looked up in
 * the catalogue by code — a rule that names a code absent from the catalogue is dropped (and a unit test
 * fails), so nothing is ever recommended that the catalogue does not define.
 */

export type OpportunityLevel = "QUICK_WIN" | "CORE_IMPROVEMENT" | "LONG_TERM" | "DO_NOT_PITCH";
export type Effort = "Low" | "Medium" | "High";
export type DeliveryForm = "MONTHLY_PACKAGE" | "SEPARATE_PROJECT";

export interface Rule {
  area: FrameworkAreaId;
  /** Only fire when a supporting finding key starts with one of these (omit = any). */
  keys?: string[];
  code: string;
  level: Exclude<OpportunityLevel, "DO_NOT_PITCH">;
  deliverables: string;
  outcome: string;
  metric: string;
  effort: Effort;
  ngoInputs: string;
  thirdParty: string;
  ongoing: boolean;
  /** Extra caveat appended to the reason. */
  caveat?: string;
}

export const RULES: Rule[] = [
  // donation & volunteer journeys
  { area: "donation", keys: ["site.broken"], code: "TP-02", level: "QUICK_WIN", deliverables: "Repair or redirect the broken donation link and re-test the path from the homepage.", outcome: "Supporters who click “donate” reach a working page.", metric: "Donate-link click-through to a loaded page; completed donations (via NGO's payment provider)", effort: "Low", ngoInputs: "CMS or hosting access", thirdParty: "Website host / CMS", ongoing: false },
  { area: "donation", code: "LG-06", level: "CORE_IMPROVEMENT", deliverables: "A focused donation page: clear ask, trust signals (registrations, how funds are used), mobile-first layout and a visible path from every page.", outcome: "A simpler, more trustworthy route from interest to gift.", metric: "Donate-page visits, donation-form starts and completions, conversion rate", effort: "Medium", ngoInputs: "Programme facts, registration details, payment provider account", thirdParty: "Payment gateway and its fees; hosting", ongoing: false },
  { area: "donation", code: "TP-08", level: "LONG_TERM", deliverables: "Donation funnel engineering: payment integration, receipts and thank-you flow connected to tracking.", outcome: "A measured, end-to-end giving funnel.", metric: "Funnel completion rate; repeat-gift rate", effort: "High", ngoInputs: "Payment gateway account, receipting rules, 80G details", thirdParty: "Payment gateway, hosting, CRM/email platform", ongoing: false, caveat: "Receipting and tax-compliance rules stay with the NGO." },
  { area: "volunteer", keys: ["site.broken"], code: "TP-02", level: "QUICK_WIN", deliverables: "Repair or redirect the broken volunteer link and re-test.", outcome: "Interested volunteers reach a working sign-up route.", metric: "Volunteer-page visits and sign-up starts", effort: "Low", ngoInputs: "CMS access", thirdParty: "Website host / CMS", ongoing: false },
  { area: "volunteer", code: "LG-06", level: "CORE_IMPROVEMENT", deliverables: "A volunteer landing page with a short registration form, clear roles and next steps, linked from the main navigation.", outcome: "Willing volunteers can sign up in one step.", metric: "Volunteer CTA clicks, completed registrations, qualified enquiries", effort: "Low", ngoInputs: "Volunteer roles, who follows up on sign-ups", thirdParty: "Form/CRM tool if needed", ongoing: false },
  { area: "volunteer", code: "LG-14", level: "LONG_TERM", deliverables: "Local volunteer and donor lead generation campaigns around the NGO's city.", outcome: "A steady local pipeline of volunteers and supporters.", metric: "Qualified local sign-ups per month", effort: "High", ngoInputs: "Capacity to follow up with leads", thirdParty: "Advertising spend, messaging fees", ongoing: true },
  // website & accessibility
  { area: "website-ux", keys: ["site.https", "site.broken", "journey.contact"], code: "TP-02", level: "QUICK_WIN", deliverables: "Fix the specific technical issue found (HTTPS redirect, broken link or missing contact route) and verify.", outcome: "A site that is secure and has working basics.", metric: "Issue re-test passes; contact-form or enquiry volume", effort: "Low", ngoInputs: "Hosting / DNS / CMS access", thirdParty: "Hosting, SSL certificate (often free)", ongoing: false },
  { area: "website-ux", code: "TP-01", level: "LONG_TERM", deliverables: "UI/UX design of the key screens (home, programmes, donate, volunteer).", outcome: "A clearer structure that makes programmes and ways to help easy to find.", metric: "Task completion in a short usability check; bounce rate on the homepage", effort: "High", ngoInputs: "Stakeholder time, content", thirdParty: "None for design", ongoing: false },
  { area: "accessibility-mobile", keys: ["site.perf"], code: "SEO-14", level: "QUICK_WIN", deliverables: "Core Web Vitals and speed fixes: image compression, script deferral, caching guidance.", outcome: "Faster pages on mobile networks.", metric: "PageSpeed mobile score and LCP before/after", effort: "Medium", ngoInputs: "Hosting / CMS access", thirdParty: "Hosting plan, CDN if used", ongoing: false },
  { area: "accessibility-mobile", code: "TP-02", level: "CORE_IMPROVEMENT", deliverables: "Responsive, accessible fixes: mobile viewport, image alt text, form labels, language attributes.", outcome: "A site that works on phones and with assistive technology.", metric: "Mobile usability issues resolved; accessibility checker pass rate", effort: "Medium", ngoInputs: "CMS access, image descriptions review", thirdParty: "Website host / CMS", ongoing: false },
  // search
  { area: "search-seo", keys: ["seo.basics"], code: "SEO-02", level: "QUICK_WIN", deliverables: "Unique titles, meta descriptions, headings and internal links for the homepage and key pages.", outcome: "Clearer search listings that explain the work.", metric: "Search impressions and clicks (Search Console), click-through rate", effort: "Low", ngoInputs: "CMS access or a publishing contact", thirdParty: "None", ongoing: true },
  { area: "search-seo", keys: ["seo.structured-data"], code: "SEO-13", level: "QUICK_WIN", deliverables: "Organization / NGO structured data (schema) for the website.", outcome: "More accurate organisation details in search results.", metric: "Rich-result eligibility in Search Console", effort: "Low", ngoInputs: "Verified organisation details", thirdParty: "None", ongoing: false },
  { area: "search-seo", keys: ["seo.sitemap", "seo.canonical"], code: "SEO-03", level: "QUICK_WIN", deliverables: "Technical SEO fixes: XML sitemap, canonical tags, robots directives.", outcome: "Search engines can crawl and index the right pages.", metric: "Indexed pages in Search Console", effort: "Low", ngoInputs: "CMS / hosting access", thirdParty: "None", ongoing: false },
  { area: "search-seo", keys: ["search."], code: "SEO-01", level: "CORE_IMPROVEMENT", deliverables: "SEO audit and strategy including brand-query and local-search visibility checked in Google and Search Console.", outcome: "A prioritised, evidence-based plan for being found.", metric: "Branded and cause-related impressions and clicks", effort: "Medium", ngoInputs: "Search Console access", thirdParty: "None", ongoing: false },
  // social
  { area: "social", code: "DM-01", level: "CORE_IMPROVEMENT", deliverables: "Content calendar, post design from a consistent template kit, captions and scheduling for the NGO's priority platforms.", outcome: "A regular, recognisable presence on the channels supporters use.", metric: "Posts published vs planned; reach and engagement rate", effort: "Medium", ngoInputs: "Photos and programme facts with consent status; one named approver", thirdParty: "Scheduling tool (agency-provided); ad spend if boosted", ongoing: true, caveat: "Confirm the NGO's actual social activity first — it could not be observed automatically." },
  { area: "storytelling", keys: ["content.impact"], code: "DM-24", level: "CORE_IMPROVEMENT", deliverables: "A monthly impact story for the website, repurposed into social posts and the newsletter.", outcome: "Verified results are easier for donors and partners to see.", metric: "Story page sessions and time on page; shares", effort: "Medium", ngoInputs: "Programme data, quotes and documented consent", thirdParty: "None", ongoing: true, caveat: "Beneficiary stories are used only with documented informed consent." },
  { area: "storytelling", keys: ["content.impact", "site.freshness"], code: "FM-15", level: "LONG_TERM", deliverables: "Testimonial / case-study film with volunteers, donors or (with consent) beneficiaries.", outcome: "A shareable proof-of-impact asset.", metric: "Video views and completion; enquiries attributed to the film", effort: "High", ngoInputs: "Access to people and sites; consent", thirdParty: "Travel, permissions", ongoing: false },
  { area: "media-content", code: "FM-04", level: "CORE_IMPROVEMENT", deliverables: "Short-form videos edited from the NGO's own footage, captioned for social platforms.", outcome: "More shareable programme content.", metric: "Videos published; views and completion", effort: "Medium", ngoInputs: "Raw footage or photo sets", thirdParty: "Licensed music (agency library)", ongoing: true },
  // reports & credibility
  { area: "annual-report-design", code: "BR-23", level: "LONG_TERM", deliverables: "Annual impact report design (layout, charts, narrative structure) plus a web summary page.", outcome: "A report funders and CSR teams can scan quickly.", metric: "Report downloads, report-page engagement, partnership enquiries", effort: "High", ngoInputs: "Audited figures, programme outcomes, photographs with consent", thirdParty: "Printing if required", ongoing: false },
  { area: "credibility", code: "TP-02", level: "QUICK_WIN", deliverables: "A transparency and credentials page (registrations, governance, reports) linked from the footer and donate page.", outcome: "Donors and CSR teams can see credentials in one place.", metric: "Transparency-page visits; donation conversion on pages that link it", effort: "Low", ngoInputs: "Registration numbers and certificates the NGO chooses to publish", thirdParty: "None", ongoing: false, caveat: "Only credentials the NGO supplies and can substantiate are published." },
  { area: "csr", code: "BR-14", level: "CORE_IMPROVEMENT", deliverables: "A corporate-partnership one-pager and brochure.", outcome: "A clear proposition for companies exploring CSR partnerships.", metric: "Partnership enquiries; one-pager downloads", effort: "Medium", ngoInputs: "Programme costs and outcomes, registration details", thirdParty: "Printing", ongoing: false },
  { area: "csr", code: "BR-12", level: "LONG_TERM", deliverables: "CSR pitch deck design.", outcome: "A reusable deck for corporate meetings.", metric: "Meetings secured using the deck", effort: "Medium", ngoInputs: "Content and approvals", thirdParty: "None", ongoing: false },
  { area: "grants-awards", code: "PR-10", level: "LONG_TERM", deliverables: "Award and recognition research and application support.", outcome: "Credibility and funding opportunities pursued systematically.", metric: "Applications submitted; awards won", effort: "Medium", ngoInputs: "Programme evidence", thirdParty: "Application fees where applicable", ongoing: false },
  { area: "pr-media", code: "PR-02", level: "QUICK_WIN", deliverables: "A press release for a recent milestone, written and distributed.", outcome: "Coverage of recent work in local media.", metric: "Pickups and referral traffic", effort: "Low", ngoInputs: "A newsworthy milestone, quotes, photos", thirdParty: "Distribution costs", ongoing: false },
  { area: "pr-media", code: "PR-01", level: "LONG_TERM", deliverables: "Ongoing media relations and outreach.", outcome: "A relationship with relevant reporters.", metric: "Earned media mentions", effort: "High", ngoInputs: "Spokesperson time", thirdParty: "None", ongoing: true },
  { area: "donor-crm", code: "DM-07", level: "CORE_IMPROVEMENT", deliverables: "A monthly supporter newsletter template and send.", outcome: "A regular, owned channel to supporters.", metric: "Subscribers, open and click rates", effort: "Low", ngoInputs: "Contact list with consent basis; sending platform", thirdParty: "Email platform fees", ongoing: true },
  { area: "donor-crm", code: "DM-15", level: "LONG_TERM", deliverables: "A donor thank-you, receipt and re-ask sequence.", outcome: "More first-time donors become repeat donors.", metric: "Repeat-gift rate", effort: "Medium", ngoInputs: "Donor platform access", thirdParty: "CRM/email platform", ongoing: true },
  { area: "events-campaigns", code: "PRO-09", level: "LONG_TERM", deliverables: "A seasonal or festive fundraising campaign plan and assets.", outcome: "A time-bound reason for supporters to act.", metric: "Campaign-attributed donations and sign-ups", effort: "High", ngoInputs: "Campaign goal and dates", thirdParty: "Ad spend, venue, printing", ongoing: false },
  { area: "regional-language", code: "SEO-08", level: "LONG_TERM", deliverables: "Multilingual SEO: regional-language landing pages and search optimisation.", outcome: "Local-language audiences can find and understand the NGO.", metric: "Regional-language impressions and sessions", effort: "High", ngoInputs: "Reviewed translations", thirdParty: "Translator review", ongoing: false },
  { area: "privacy-consent", code: "AN-14", level: "CORE_IMPROVEMENT", deliverables: "Consent and privacy compliance: privacy notice, consent wording on forms, cookie notice.", outcome: "Clear, defensible handling of supporter data.", metric: "Forms linked to a privacy notice; consent captured on sign-ups", effort: "Low", ngoInputs: "How data is used internally", thirdParty: "Consent-tool licence if needed", ongoing: false, caveat: "Not legal advice; the NGO's counsel should review the final wording." },
  { area: "analytics", code: "AN-01", level: "CORE_IMPROVEMENT", deliverables: "GA4 and conversion tracking set up for donate, volunteer and contact actions.", outcome: "The team can see which pages and channels produce actions.", metric: "Tracked conversions per month; data completeness", effort: "Low", ngoInputs: "Analytics and site access", thirdParty: "None (Google tools are free)", ongoing: false },
  { area: "ad-grants", code: "AD-01", level: "LONG_TERM", deliverables: "Google Ad Grants eligibility check, account setup and ongoing management.", outcome: "Sponsored search visibility funded by the grant.", metric: "Grant-funded clicks and conversions", effort: "High", ngoInputs: "Active Google for Nonprofits account and verified eligibility", thirdParty: "None for grant spend (credit); policy compliance is ongoing", ongoing: true, caveat: "Eligibility and policy compliance must be verified before this is proposed." },
  { area: "brand", keys: ["brand.share-assets"], code: "BR-17", level: "QUICK_WIN", deliverables: "A social media design system including favicon and share-image assets.", outcome: "Links and posts look recognisably like the NGO.", metric: "Template adoption; click-through on shared links", effort: "Low", ngoInputs: "Logo files, colours", thirdParty: "None", ongoing: false },
];

const STATE_ALLOWED: GapState[] = ["CONFIRMED_ISSUE", "LIKELY_OPPORTUNITY", "NOT_FOUND_PUBLICLY"];

export interface Recommendation {
  areaId: FrameworkAreaId;
  findingKey: string;
  serviceCode: string;
  serviceName: string;
  practiceArea: string;
  level: OpportunityLevel;
  reason: string;
  proposedDeliverables: string;
  expectedOutcome: string;
  successMetric: string;
  effort: Effort;
  ngoInputs: string;
  thirdPartyDeps: string;
  priority: Priority;
  confidence: Confidence;
  pricingEligibility: Eligibility;
  packageTiers: Tier[];
  addOnNames: string[];
  isOngoing: boolean;
  deliveryForm: DeliveryForm;
  evidenceUrls: string[];
}

export interface MatchResult {
  recommendations: Recommendation[];
  doNotPitch: Recommendation[];
}

const LEVEL_ORDER: Record<OpportunityLevel, number> = { QUICK_WIN: 0, CORE_IMPROVEMENT: 1, LONG_TERM: 2, DO_NOT_PITCH: 3 };
const MAX_RECOMMENDATIONS = 10;

export function matchServices(args: {
  areas: AreaAssessment[];
  top: RankedOpportunity[];
  catalogue: Catalogue;
  location?: string;
}): MatchResult {
  const { areas, top, catalogue } = args;
  const byArea = new Map(areas.map((a) => [a.area.id, a]));
  const recs = new Map<string, Recommendation>();

  // Areas in rank order: the five best opportunities first, then every other evidenced gap.
  const orderedIds = [...top.map((t) => t.areaId), ...areas.filter((a) => a.gapState && STATE_ALLOWED.includes(a.gapState) && !top.some((t) => t.areaId === a.area.id)).map((a) => a.area.id)];

  for (const areaId of orderedIds) {
    const a = byArea.get(areaId);
    if (!a?.finding || !a.gapState || !STATE_ALLOWED.includes(a.gapState)) continue;
    const f = a.finding;
    const rules = RULES.filter((r) => r.area === areaId && (!r.keys || a.supportingKeys.some((k) => r.keys?.some((p) => k.startsWith(p)))));
    // Keys-specific rules take precedence over the generic rule for the same area.
    const specific = rules.filter((r) => r.keys);
    const chosen = specific.length ? [...specific, ...rules.filter((r) => !r.keys && r.level !== "QUICK_WIN")] : rules;
    for (const rule of chosen) {
      if (recs.size >= MAX_RECOMMENDATIONS && !recs.has(rule.code)) continue;
      const svc = catalogue.byCode.get(rule.code);
      if (!svc) continue; // never recommend something the catalogue does not define
      if (recs.has(rule.code)) {
        const r = recs.get(rule.code) as Recommendation;
        if (!r.reason.includes(f.title)) r.reason += ` Also addresses: ${f.title}.`;
        r.evidenceUrls = [...new Set([...r.evidenceUrls, ...f.evidenceUrls])];
        continue;
      }
      const notFoundNote = a.gapState === "NOT_FOUND_PUBLICLY" ? " This rests on something not being found publicly, so confirm with the NGO that it is not already handled elsewhere before proposing." : "";
      const tiers = svc.tiers.map((t) => t.tier);
      recs.set(rule.code, {
        areaId, findingKey: f.key, serviceCode: svc.code, serviceName: svc.name, practiceArea: svc.practiceAreaName,
        level: rule.level,
        reason: `${f.title}. ${f.observation.split(". ")[0].replace(/\.$/, "")}.${rule.caveat ? ` ${rule.caveat}` : ""}${notFoundNote}`,
        proposedDeliverables: rule.deliverables, expectedOutcome: rule.outcome, successMetric: rule.metric,
        effort: rule.effort, ngoInputs: rule.ngoInputs, thirdPartyDeps: rule.thirdParty,
        priority: f.priority ?? "LOW", confidence: f.confidence,
        pricingEligibility: rule.code === "AD-01" ? "REQUIRES_APPROVAL" : svc.eligibility,
        packageTiers: tiers, addOnNames: svc.addOns.map((x) => x.name),
        isOngoing: rule.ongoing, deliveryForm: tiers.length && rule.ongoing ? "MONTHLY_PACKAGE" : "SEPARATE_PROJECT",
        evidenceUrls: f.evidenceUrls,
      });
    }
  }

  const recommendations = [...recs.values()].sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level] || rank(y.priority) - rank(x.priority));
  return { recommendations, doNotPitch: buildDoNotPitch(areas, catalogue, recommendations) };
}

const rank = (p: Priority) => ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 })[p];

/** Services that would be premature, unsupported by the evidence, or poor value — with the reason. */
function buildDoNotPitch(areas: AreaAssessment[], catalogue: Catalogue, recs: Recommendation[]): Recommendation[] {
  const out: Recommendation[] = [];
  const state = (id: FrameworkAreaId) => areas.find((a) => a.area.id === id);
  const add = (code: string, reason: string, areaId: FrameworkAreaId = "website-ux") => {
    const svc = catalogue.byCode.get(code);
    if (!svc || recs.some((r) => r.serviceCode === code) || out.some((o) => o.serviceCode === code)) return;
    out.push({
      areaId, findingKey: "policy.do-not-pitch", serviceCode: svc.code, serviceName: svc.name, practiceArea: svc.practiceAreaName,
      level: "DO_NOT_PITCH", reason, proposedDeliverables: "—", expectedOutcome: "—", successMetric: "—", effort: "High",
      ngoInputs: "—", thirdPartyDeps: "—", priority: "LOW", confidence: "HIGH", pricingEligibility: svc.eligibility,
      packageTiers: svc.tiers.map((t) => t.tier), addOnNames: svc.addOns.map((x) => x.name), isOngoing: false,
      deliveryForm: "SEPARATE_PROJECT", evidenceUrls: [],
    });
  };

  add("TP-03", "No evidence of need for a mobile app. The package workbook itself says to challenge the need before quoting; a responsive website covers most NGO needs.");
  add("TP-05", "No evidence of enquiry or workflow volume that would justify automation or agents. Revisit once basic journeys are measured.");
  add("TP-06", "No evidence of enquiry volume that a chatbot would help with, and bots add maintenance and moderation load. Revisit after the contact and donation journeys are working and measured.");
  add("BR-03", "Logo redesign is not supported by the evidence: brand quality cannot be judged from automated checks, and a rebrand is a large change to propose without a conversation with the team.", "brand");
  add("BR-07", "A full rebrand or refresh is not evidenced by the audit. Offer it only if the team raises brand inconsistency themselves.", "brand");

  const donation = state("donation");
  const hasDonationPath = donation && donation.gapState === null;
  const analytics = state("analytics");
  const noMeasurable = !hasDonationPath || (analytics && analytics.gapState !== null);
  if (noMeasurable) {
    add("AD-03", "Paid social is premature: a measurable destination (working donation or volunteer page with tracking) was not established, so ad spend could not be attributed.", "donation");
    add("AD-01", "Paid search is premature until a measurable destination exists and, for Google Ad Grants, eligibility is verified.", "ad-grants");
  }
  add("DM-27", "A fractional CMO retainer is not justified by any evidenced gap and is a high-commitment first offer.");
  return out;
}
