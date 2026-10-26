import type { Channel, PitchFacts, Tone } from "./types";

/**
 * Deterministic pitch composer. Every sentence about the NGO comes from `PitchFacts` (which is built
 * from evidenced, correctly hedged findings); the composer adds only structure, courtesy and one ask.
 * It never states a price, a result, or a claim the facts do not support.
 */

interface ToneSpec {
  greet: (n: string) => string;
  opener: (f: PitchFacts) => string;
  close: string;
  ask: string;
  askShort: string;
  maxPoints: number;
}

const placeLine = (f: PitchFacts) => (f.location ? ` in ${f.location}` : "");

const TONES: Record<Tone, ToneSpec> = {
  "warm-professional": {
    greet: (n) => `Dear ${n} team,`,
    opener: (f) => `I am ${f.sender.name} from Kreatif Atelier, a digital and brand studio that works with NGOs. I have been reading about ${f.ngoName}'s work${placeLine(f)} and spent some time looking at your public website${f.siteUrl ? ` (${f.siteUrl})` : ""}.`,
    close: "Warm regards,",
    ask: "Would you be open to a 20-minute call in the next couple of weeks to see whether any of this would be useful? If someone else on your team looks after this, I would be grateful if you could point me to them.",
    askShort: "Would a short 20-minute call in the next couple of weeks be useful?",
    maxPoints: 3,
  },
  "concise-direct": {
    greet: (n) => `Hello ${n} team,`,
    opener: (f) => `I am ${f.sender.name} at Kreatif Atelier, a digital and brand studio for NGOs. I reviewed ${f.ngoName}'s public website${f.siteUrl ? ` (${f.siteUrl})` : ""} and have a few specific observations.`,
    close: "Regards,",
    ask: "Would a 20-minute call in the next two weeks be worthwhile? If not the right person, a pointer to who is would help.",
    askShort: "Open to a 20-minute call in the next two weeks?",
    maxPoints: 2,
  },
  "formal-respectful": {
    greet: (n) => `Dear ${n} team,`,
    opener: (f) => `I write on behalf of Kreatif Atelier, a digital and brand studio that supports non-profit organisations. In preparing this note I reviewed the public information available about ${f.ngoName}${placeLine(f)}${f.siteUrl ? `, including your website (${f.siteUrl})` : ""}, with respect for the work you do.`,
    close: "Yours sincerely,",
    ask: "If it would be of interest, I would be grateful for a brief 20-minute conversation at a time convenient to you. Please also feel free to direct me to the colleague who handles these matters.",
    askShort: "I would be grateful for a brief conversation at your convenience.",
    maxPoints: 3,
  },
};

const signature = (f: PitchFacts) => `${f.sender.name}${f.sender.role ? `, ${f.sender.role}` : ""}\nKreatif Atelier | https://www.kreatifatelier.com/`;

const BASIS = "These observations are based only on public information and a light automated review, so some may already be handled in ways we could not see.";

const numbered = (items: string[]) => items.map((s, i) => `${i + 1}. ${s}`).join("\n");

function benefitLine(f: PitchFacts, n: number): string {
  const b = f.points.slice(0, n).map((p) => p.benefit).filter(Boolean);
  if (!b.length) return "";
  return `If useful, the aim would be simple: ${b[0].charAt(0).toLowerCase()}${b[0].slice(1).replace(/\.$/, "")}.`;
}

export interface Composed {
  channel: Channel;
  subject?: string;
  body: string;
}

export function composeChannel(channel: Channel, f: PitchFacts, tone: Tone): Composed {
  const t = TONES[tone];
  const pts = f.points.slice(0, t.maxPoints);
  const sentences = pts.map((p) => p.sentence);
  const strength = f.strength ? `What already works well: ${f.strength}\n\n` : "";
  const noPoints = pts.length === 0;

  switch (channel) {
    case "COLD_EMAIL": {
      const middle = noPoints
        ? `I did not find a gap I could stand behind from public information alone, so rather than guess I would like to ask how you currently approach your digital communications.`
        : `${strength}A few things stood out:\n${numbered(sentences)}\n\n${BASIS}`;
      return {
        channel,
        subject: `A few observations on ${f.ngoName}'s digital presence`,
        body: [t.greet(f.ngoName), t.opener(f), middle, benefitLine(f, 1), f.offer, t.ask, `${t.close}\n${signature(f)}`].filter(Boolean).join("\n\n"),
      };
    }
    case "WHATSAPP": {
      const lead = noPoints ? "" : ` One thing I noticed from your public website: ${sentences[0]}`;
      return {
        channel,
        body: `Hello, this is ${f.sender.name} from Kreatif Atelier (https://www.kreatifatelier.com/), a digital and brand studio that works with NGOs. I came across ${f.ngoName}'s work and wanted to introduce myself.${lead} ${t.askShort} Please tell me if you would rather I did not message here, and I will not.`,
      };
    }
    case "LINKEDIN": {
      const lead = noPoints ? "" : ` I noticed: ${sentences[0]}`;
      return {
        channel,
        body: `Hello, I am ${f.sender.name} at Kreatif Atelier, a digital and brand studio for NGOs. I admire ${f.ngoName}'s work.${lead} ${t.askShort}`,
      };
    }
    case "PHONE_SCRIPT": {
      const lines = [
        `Opening: "Hello, may I speak with the person who looks after ${f.ngoName}'s website or communications? This is ${f.sender.name} from Kreatif Atelier, a digital and brand studio that works with NGOs. Is this a good moment for two minutes?"`,
        `If yes: "I looked at your public website${f.siteUrl ? ` (${f.siteUrl})` : ""} and had ${noPoints ? "a question" : pts.length === 1 ? "one observation" : `${pts.length} observations`}."`,
        ...pts.map((p, i) => `Point ${i + 1}: "${p.sentence}" Ask: "Is that already handled in a way I could not see?"`),
        `Offer: "${f.offer}"`,
        `Ask: "${t.askShort}"`,
        `If they are busy: "No problem — may I send a short note instead, and when would be a better time to call?"`,
        `If they say no: "Understood, thank you for your time. I will not follow up unless you ask me to."`,
        `Voicemail (under 20 seconds): "Hello, this is ${f.sender.name} from Kreatif Atelier. I have a short note about ${f.ngoName}'s digital presence and will send it by email. Thank you."`,
      ];
      return { channel, body: lines.join("\n\n") };
    }
    case "FOLLOW_UP_EMAIL": {
      const p = pts[0];
      return {
        channel,
        subject: `Following up: ${f.ngoName}`,
        body: [
          t.greet(f.ngoName),
          `I wrote a little while ago about ${f.ngoName}'s digital presence and wanted to follow up once, gently, in case it was buried.`,
          p ? `The point I would most like to share: ${p.sentence}` : "",
          p?.benefit ? `The aim would be: ${p.benefit.charAt(0).toLowerCase()}${p.benefit.slice(1)}` : "",
          `${t.askShort} If this is not a priority right now, just say so and I will leave you in peace.`,
          `${t.close}\n${signature(f)}`,
        ].filter(Boolean).join("\n\n"),
      };
    }
    case "MEETING_REQUEST": {
      return {
        channel,
        subject: `20 minutes to discuss ${f.ngoName}'s digital presence`,
        body: [
          t.greet(f.ngoName),
          `I would like to propose a 20-minute conversation. A suggested agenda:`,
          numbered([
            `Understand what ${f.ngoName} is trying to achieve this year and who looks after digital and communications`,
            ...(noPoints ? ["Hear how you currently handle your website, social media and supporter communication"] : pts.map((p) => `Hear your view on: ${p.title.charAt(0).toLowerCase()}${p.title.slice(1)}`)),
            "Agree whether a short written proposal would be useful, and what it should cover",
          ]),
          `I can work around your schedule, online or in person${f.location ? ` if you are in or near ${f.location}` : ""}. ${f.offer}`,
          `${t.close}\n${signature(f)}`,
        ].join("\n\n"),
      };
    }
    case "ONE_PAGE_PROPOSAL": {
      const scope = pts.filter((p) => p.serviceName).map((p) => `• ${p.serviceName} — ${p.benefit || "scope to be agreed"}`);
      const pricing = f.pricingApproved
        ? f.offer
        : `[[Pricing needs human approval before this section is shared. No price has been set.]]`;
      return {
        channel,
        subject: `Proposal outline for ${f.ngoName}`,
        body: [
          `PROPOSAL OUTLINE — ${f.ngoName.toUpperCase()}`,
          `Prepared by Kreatif Atelier`,
          `1. Why we are writing\nWe reviewed ${f.ngoName}'s public digital presence${f.siteUrl ? ` (${f.siteUrl})` : ""}. ${BASIS}`,
          strength ? `2. What already works well\n${f.strength}` : "",
          `${strength ? "3" : "2"}. What we noticed\n${noPoints ? "No gap was evidenced strongly enough to recommend work from public information alone." : numbered(sentences)}`,
          `${strength ? "4" : "3"}. Suggested scope (to be refined with your team)\n${scope.length ? scope.join("\n") : "To be agreed after a conversation."}`,
          `${strength ? "5" : "4"}. How we would work\nWe would start with a short conversation, confirm what is already in place, and agree a small first step before anything larger.`,
          `${strength ? "6" : "5"}. Commercials\n${pricing}\nThird-party costs such as hosting, domains, advertising spend, messaging fees and payment-gateway charges are separate and remain with ${f.ngoName}.`,
          `${strength ? "7" : "6"}. Next step\n${t.askShort}`,
        ].filter(Boolean).join("\n\n"),
      };
    }
    case "DISCOVERY_QUESTIONS": {
      const qs = [
        `What are ${f.ngoName}'s most important goals this year (fundraising, volunteers, awareness, partnerships)?`,
        `Who looks after the website, social media and supporter communication today — staff, volunteers or an agency?`,
        ...pts.map((p) => `${p.sentence.replace(/\.$/, "")}. How is this handled today, if at all${p.mayAddressOffline ? " (including offline or through partners)" : ""}?`),
        `Which supporters or donors matter most, and how do they currently hear about you and give?`,
        `How do you currently measure whether communications and fundraising work?`,
        `What has worked well, and what has been tried and dropped?`,
        `What budget or grant constraints should we respect, and who approves decisions?`,
      ];
      return { channel, body: `Questions for a first conversation with ${f.ngoName}\n\n${numbered(qs)}` };
    }
  }
}

export function composeAll(f: PitchFacts, tone: Tone): Composed[] {
  return (["COLD_EMAIL", "WHATSAPP", "LINKEDIN", "PHONE_SCRIPT", "FOLLOW_UP_EMAIL", "MEETING_REQUEST", "ONE_PAGE_PROPOSAL", "DISCOVERY_QUESTIONS"] as Channel[]).map((c) => composeChannel(c, f, tone));
}
