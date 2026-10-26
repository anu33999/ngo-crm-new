import type { Confidence, FrameworkAreaId, GapState } from "@/lib/research/types";

export const CHANNELS = [
  "COLD_EMAIL", "WHATSAPP", "LINKEDIN", "PHONE_SCRIPT", "FOLLOW_UP_EMAIL", "MEETING_REQUEST", "ONE_PAGE_PROPOSAL", "DISCOVERY_QUESTIONS",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  COLD_EMAIL: "Cold email",
  WHATSAPP: "WhatsApp message",
  LINKEDIN: "LinkedIn message",
  PHONE_SCRIPT: "Phone call script",
  FOLLOW_UP_EMAIL: "Follow-up email",
  MEETING_REQUEST: "Meeting request",
  ONE_PAGE_PROPOSAL: "One-page proposal",
  DISCOVERY_QUESTIONS: "Discovery questions",
};

export const TONES = ["warm-professional", "concise-direct", "formal-respectful"] as const;
export type Tone = (typeof TONES)[number];
export const TONE_LABEL: Record<Tone, string> = {
  "warm-professional": "Warm and professional",
  "concise-direct": "Concise and direct",
  "formal-respectful": "Formal and respectful",
};

export interface PitchPoint {
  areaId: FrameworkAreaId;
  title: string;
  /** One sentence grounded in the observation, hedged according to the evidence state. */
  sentence: string;
  state: GapState;
  confidence: Confidence;
  evidenceUrls: string[];
  benefit: string;
  serviceName?: string;
  serviceCode?: string;
  mayAddressOffline: boolean;
}

export interface Sender {
  name: string;
  role?: string;
}

/** Everything a pitch may say. Composers never reach outside this object. */
export interface PitchFacts {
  ngoName: string;
  location?: string;
  siteUrl?: string;
  strength?: string;
  points: PitchPoint[];
  offer: string;
  sender: Sender;
  pricingApproved: boolean;
  /** Service names that must not be pitched (used by the rubric). */
  doNotPitchNames: string[];
  /** URLs the draft may cite. */
  allowedUrls: string[];
}

export interface PitchDraftOut {
  channel: Channel;
  subject?: string;
  body: string;
  /** "deterministic" or "ai". */
  origin: "deterministic" | "ai";
  lint: LintIssue[];
}

export interface LintIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface RubricBreakdown {
  specificity: number;
  evidence: number;
  relevance: number;
  value: number;
  cta: number;
  tone: number;
}

export interface ScoredDraft extends PitchDraftOut {
  score: number;
  breakdown: RubricBreakdown;
  notes: string[];
}

export const RUBRIC_MAX: RubricBreakdown = { specificity: 25, evidence: 25, relevance: 20, value: 15, cta: 10, tone: 5 };
