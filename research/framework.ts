import type { FindingCategory, FrameworkAreaId } from "./types";

/**
 * The 22-area NGO digital-maturity framework. `impact` and `feasibility` (1–5) feed opportunity
 * ranking; `unassessable` is the honest reason shown when automated checks can say nothing.
 */
export interface FrameworkArea {
  id: FrameworkAreaId;
  title: string;
  category: FindingCategory;
  impact: number;
  feasibility: number;
  whyItMatters: string;
  consequence: string;
  unassessable: string;
  /** True when much of this area happens off-line / in private systems. */
  oftenOffline: boolean;
}

export const FRAMEWORK: FrameworkArea[] = [
  { id: "brand", title: "Brand identity and positioning", category: "BRAND", impact: 3, feasibility: 3, oftenOffline: false,
    whyItMatters: "A consistent identity makes the NGO recognisable and trustworthy across website, social and print.",
    consequence: "Supporters may find it harder to recognise and remember the organisation.",
    unassessable: "Brand quality and consistency cannot be judged reliably from automated checks; it needs a visual review with the team." },
  { id: "website-ux", title: "Website design and usability", category: "WEBSITE", impact: 4, feasibility: 3, oftenOffline: false,
    whyItMatters: "The website is where donors, volunteers and partners decide whether to engage.",
    consequence: "Visitors may leave before finding programmes or ways to help.",
    unassessable: "Usability needs hands-on review; only structural signals were checked." },
  { id: "donation", title: "Donation infrastructure", category: "DONATION_VOLUNTEER", impact: 5, feasibility: 3, oftenOffline: true,
    whyItMatters: "A clear, trustworthy online giving path lets supporters act at the moment they are moved.",
    consequence: "Interested supporters may not have an obvious way to give online.",
    unassessable: "The donation path could not be checked because the website was not accessible." },
  { id: "volunteer", title: "Volunteer recruitment and onboarding", category: "DONATION_VOLUNTEER", impact: 4, feasibility: 4, oftenOffline: true,
    whyItMatters: "Volunteers extend capacity; a visible sign-up path converts goodwill into help.",
    consequence: "Willing volunteers may not know how to get involved.",
    unassessable: "The volunteer path could not be checked because the website was not accessible." },
  { id: "search-seo", title: "Search visibility and local SEO", category: "SEO", impact: 4, feasibility: 4, oftenOffline: false,
    whyItMatters: "Good page titles, descriptions and structure help people find the NGO when searching for its cause or location.",
    consequence: "The NGO may be harder to find for people searching for its cause or area.",
    unassessable: "Search signals could not be inspected because the website was not accessible." },
  { id: "ad-grants", title: "Google Ad Grants readiness and management", category: "SEO", impact: 3, feasibility: 2, oftenOffline: true,
    whyItMatters: "Eligible nonprofits can receive sponsored search advertising credit, but accounts need ongoing management.",
    consequence: "Available advertising support may be unused or mismanaged.",
    unassessable: "Eligibility depends on Google for Nonprofits verification and programme policies, which cannot be established from public pages." },
  { id: "social", title: "Social media consistency", category: "SOCIAL", impact: 4, feasibility: 4, oftenOffline: false,
    whyItMatters: "Regular, clear posting keeps supporters informed and builds credibility.",
    consequence: "Followers and prospective supporters may see an inactive or unclear presence.",
    unassessable: "Social platforms restrict automated access, so posting activity could not be observed." },
  { id: "storytelling", title: "Impact storytelling", category: "IMPACT_REPORTING", impact: 4, feasibility: 4, oftenOffline: false,
    whyItMatters: "Stories and outcomes help donors and partners understand what their support changes.",
    consequence: "Good work may be harder for supporters to see and share.",
    unassessable: "Storytelling could not be checked because the website was not accessible." },
  { id: "media-content", title: "Photography, video and documentary content", category: "CONTENT_MEDIA", impact: 3, feasibility: 3, oftenOffline: false,
    whyItMatters: "Authentic photo and video content is the most shareable way to show programme work.",
    consequence: "Programme work may be under-represented visually.",
    unassessable: "Media quality cannot be judged by automated checks." },
  { id: "annual-report-design", title: "NGO profile and annual report design", category: "IMPACT_REPORTING", impact: 3, feasibility: 3, oftenOffline: true,
    whyItMatters: "A clear, well-designed report is the main document funders and CSR teams read.",
    consequence: "Funders may struggle to find or digest the organisation's results.",
    unassessable: "Report availability could not be checked because the website was not accessible." },
  { id: "credibility", title: "Public credibility and transparency", category: "COMPLIANCE", impact: 4, feasibility: 4, oftenOffline: true,
    whyItMatters: "Visible registrations, governance and financial information are what donors and CSR teams look for first.",
    consequence: "Prospective supporters may hesitate when credentials are hard to find.",
    unassessable: "Credentials could not be checked because the website was not accessible." },
  { id: "csr", title: "CSR and corporate partnership materials", category: "COMMUNICATIONS", impact: 3, feasibility: 3, oftenOffline: true,
    whyItMatters: "Corporate partners look for a clear proposition, past results and compliance details.",
    consequence: "Companies may not have an easy way to understand how to partner.",
    unassessable: "Partnership content could not be checked because the website was not accessible." },
  { id: "grants-awards", title: "Grant and award discovery", category: "COMMUNICATIONS", impact: 2, feasibility: 3, oftenOffline: true,
    whyItMatters: "Awards and grants build credibility and funding.",
    consequence: "Eligible recognition and funding opportunities may go unexplored.",
    unassessable: "Grant and award pursuit happens largely off-line and cannot be assessed from public pages." },
  { id: "pr-media", title: "PR and media relations", category: "COMMUNICATIONS", impact: 3, feasibility: 3, oftenOffline: true,
    whyItMatters: "Earned media extends reach and trust beyond the NGO's own channels.",
    consequence: "Programme news may reach fewer people.",
    unassessable: "Media relationships are largely private; only public coverage was sampled." },
  { id: "impact-measurement", title: "Impact measurement and reporting", category: "IMPACT_REPORTING", impact: 4, feasibility: 2, oftenOffline: true,
    whyItMatters: "Measured outcomes are what funders increasingly ask for.",
    consequence: "Results may be hard to evidence to funders.",
    unassessable: "Internal measurement systems are not visible publicly." },
  { id: "donor-crm", title: "Donor retention and CRM", category: "COMMUNICATIONS", impact: 4, feasibility: 3, oftenOffline: true,
    whyItMatters: "Thanking, updating and re-engaging donors is cheaper than acquiring new ones.",
    consequence: "First-time supporters may not be turned into repeat supporters.",
    unassessable: "Donor systems are private; only public sign-up points were checked." },
  { id: "events-campaigns", title: "Events and fundraising campaigns", category: "COMMUNICATIONS", impact: 3, feasibility: 3, oftenOffline: true,
    whyItMatters: "Campaigns give supporters a time-bound reason to act.",
    consequence: "Fundraising moments may be under-promoted.",
    unassessable: "Event and campaign activity cannot be fully observed from public pages." },
  { id: "staff-training", title: "Staff training and digital ownership", category: "OTHER", impact: 3, feasibility: 4, oftenOffline: true,
    whyItMatters: "Teams that can maintain their own channels keep improvements going.",
    consequence: "Improvements may lapse when external support ends.",
    unassessable: "Internal capability cannot be assessed from public information; ask in a discovery call." },
  { id: "regional-language", title: "Regional-language communications", category: "CONTENT_MEDIA", impact: 3, feasibility: 3, oftenOffline: false,
    whyItMatters: "Content in the local language reaches the communities and donors closest to the work.",
    consequence: "Local audiences may be less able to engage.",
    unassessable: "Language coverage could not be checked because the website was not accessible." },
  { id: "privacy-consent", title: "Privacy, consent and beneficiary data handling", category: "PRIVACY_ACCESSIBILITY", impact: 4, feasibility: 4, oftenOffline: true,
    whyItMatters: "Clear privacy and consent practices protect donors and beneficiaries and build trust.",
    consequence: "Supporters and partners may question how data is handled.",
    unassessable: "Data-handling practice is internal; only published notices were checked." },
  { id: "analytics", title: "Analytics, tracking and reporting", category: "ANALYTICS", impact: 4, feasibility: 4, oftenOffline: false,
    whyItMatters: "Measurement shows which actions and channels are working.",
    consequence: "Decisions about content and campaigns may rely on guesswork.",
    unassessable: "Analytics could not be checked because the website was not accessible." },
  { id: "accessibility-mobile", title: "Digital accessibility and mobile usability", category: "PRIVACY_ACCESSIBILITY", impact: 4, feasibility: 4, oftenOffline: false,
    whyItMatters: "Most supporters in India browse on mobile; accessible pages work for everyone.",
    consequence: "Some visitors may struggle to use the site.",
    unassessable: "Accessibility and mobile checks could not be run because the website was not accessible." },
];

export const FRAMEWORK_BY_ID = Object.fromEntries(FRAMEWORK.map((a) => [a.id, a])) as Record<FrameworkAreaId, FrameworkArea>;
