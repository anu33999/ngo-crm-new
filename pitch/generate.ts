import { z } from "zod";
import { extractJson, type AiClient } from "@/lib/ai/anthropic";
import { UNTRUSTED_NOTICE, wrapUntrusted } from "@/lib/ai/untrusted";
import { composeAll } from "./compose";
import { hasErrors, lintDraft } from "./lint";
import { scoreDraft } from "./rubric";
import { CHANNELS, TONE_LABEL, type Channel, type PitchDraftOut, type PitchFacts, type ScoredDraft, type Tone } from "./types";

export interface PitchBundle {
  tone: Tone;
  generatedBy: "deterministic" | "ai" | "mixed";
  drafts: ScoredDraft[];
  totalScore: number;
  warnings: string[];
}

const AiReply = z.object({
  drafts: z.array(z.object({ channel: z.enum(CHANNELS), subject: z.string().max(200).optional(), body: z.string().min(20).max(6000) })).min(1),
});

function systemPrompt(tone: Tone) {
  return [
    "You write first-contact outreach drafts for Kreatif Atelier, a digital and brand studio that works with Indian NGOs. A human reviews every draft; nothing is sent automatically.",
    `Tone: ${TONE_LABEL[tone]}. Respectful, specific, plain English. No hype, no flattery, no pressure, no exclamation marks, no clichés such as "hope this finds you well".`,
    "Rules you must follow:",
    "- Use ONLY the facts in the FACTS block. Do not invent achievements, numbers, staff names, results, prices, discounts or deadlines.",
    "- Each observation already carries the correct level of certainty. Keep its hedging. Never say something does not exist; say it could not be found publicly.",
    "- Never mention prices, “free”, “no fee” or costs unless the FACTS block contains an approved OFFER sentence; if so, use that sentence as written.",
    "- Include exactly one clear, low-pressure call to action per message (except the discovery questions and phone script).",
    "- Only link to URLs that appear in FACTS.",
    "- Never mention internal scores, margins, hours or rubric details.",
    UNTRUSTED_NOTICE,
    'Reply with JSON only: {"drafts":[{"channel":"COLD_EMAIL","subject":"...","body":"..."}, ...]} covering every channel requested.',
  ].join("\n");
}

function userPrompt(f: PitchFacts, base: PitchDraftOut[]) {
  const factsBlock = JSON.stringify({
    ngoName: f.ngoName, location: f.location, website: f.siteUrl, whatWorksWell: f.strength,
    observations: f.points.map((p) => ({ sentence: p.sentence, evidenceUrls: p.evidenceUrls, intendedBenefit: p.benefit, relatedService: p.serviceName })),
    OFFER: f.offer, sender: f.sender, mayBeHandledOffline: f.points.filter((p) => p.mayAddressOffline).map((p) => p.title),
  }, null, 2);
  return [
    "FACTS (copied from our own audit; the sentences were derived from third-party pages):",
    wrapUntrusted("audit-facts", factsBlock),
    "",
    `Write a polished version of each draft below, keeping every fact, hedge and link intact. Channels: ${base.map((b) => b.channel).join(", ")}.`,
    "Baseline drafts to improve (do not weaken their hedging or add facts):",
    JSON.stringify(base.map((b) => ({ channel: b.channel, subject: b.subject, body: b.body }))),
  ].join("\n");
}

/**
 * Build all channel drafts. The deterministic composer always runs; if an AI client is supplied it is asked to
 * polish the drafts, and each AI draft is accepted only if it passes the same lint and scores at least as well.
 */
export async function generatePitch(args: { facts: PitchFacts; tone: Tone; ai?: AiClient | null; signal?: AbortSignal }): Promise<PitchBundle> {
  const { facts, tone, ai, signal } = args;
  const warnings: string[] = [];

  const base: ScoredDraft[] = composeAll(facts, tone).map((c) => {
    const lint = lintDraft(c.channel, c.body, facts, c.subject);
    return scoreDraft({ channel: c.channel, subject: c.subject, body: c.body, origin: "deterministic", lint }, facts);
  });

  let drafts = base;
  let usedAi = 0;
  if (ai && facts.points.length > 0) {
    try {
      const raw = await ai.complete({ system: systemPrompt(tone), user: userPrompt(facts, base), maxTokens: 6000, signal });
      const parsed = AiReply.parse(extractJson(raw));
      const byChannel = new Map<Channel, (typeof parsed.drafts)[number]>(parsed.drafts.map((d) => [d.channel, d]));
      drafts = base.map((b) => {
        const cand = byChannel.get(b.channel);
        if (!cand) return b;
        const lint = lintDraft(b.channel, cand.body, facts, cand.subject ?? b.subject);
        if (hasErrors(lint)) {
          warnings.push(`AI draft for ${b.channel} was rejected by the safety lint (${lint.filter((i) => i.severity === "error").map((i) => i.code).join(", ")}); the deterministic draft was kept.`);
          return b;
        }
        const scored = scoreDraft({ channel: b.channel, subject: cand.subject ?? b.subject, body: cand.body, origin: "ai", lint }, facts);
        if (scored.score < b.score) {
          warnings.push(`AI draft for ${b.channel} scored lower on the rubric (${scored.score} vs ${b.score}); the deterministic draft was kept.`);
          return b;
        }
        usedAi++;
        return scored;
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      warnings.push(`AI polishing was unavailable (${e instanceof Error ? e.message.slice(0, 120) : "error"}); deterministic drafts were used.`);
    }
  } else if (!ai) {
    warnings.push("No ANTHROPIC_API_KEY configured: drafts were composed deterministically from the evidence.");
  }
  if (facts.points.length === 0) warnings.push("No gap was evidenced strongly enough to ground a specific observation; the drafts are discovery-oriented rather than a pitch.");

  const totalScore = Math.round(drafts.reduce((s, d) => s + d.score, 0) / drafts.length);
  return { tone, generatedBy: usedAi === 0 ? "deterministic" : usedAi === drafts.length ? "ai" : "mixed", drafts, totalScore, warnings };
}
