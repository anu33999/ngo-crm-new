import { classifyUrl, canonicalUrl, hostOf, registrableDomain } from "@/lib/search/normalize";
import type { SearchResult } from "@/lib/search/types";
import { dice, nameSimilarity, normalizeName, tokens } from "./text";

export interface IdentityQuery {
  name: string;
  location?: string;
}

export interface Candidate {
  key: string; // stable id for selection: registrable domain, or "dir:<normalized title>"
  name: string;
  domain?: string;
  website?: string;
  locationHints: string[];
  evidenceUrls: string[];
  score: number; // 0..1
  signals: string[]; // human-readable reasons, shown to the reviewer
  directoryOnly: boolean;
}

export type Resolution =
  | { status: "resolved"; candidate: Candidate; runnerUps: Candidate[]; needsConfirmation: boolean }
  | { status: "ambiguous"; candidates: Candidate[] }
  | { status: "unresolved"; candidates: Candidate[] };

const SPLIT_TITLE = /\s*[|–—\-:·•»]\s*/;

function bestTitleSegment(title: string, target: string): { seg: string; sim: number } {
  const segs = [title, ...title.split(SPLIT_TITLE)].map((s) => s.trim()).filter(Boolean);
  let best = { seg: title.trim(), sim: 0 };
  for (const s of segs) {
    const sim = nameSimilarity(s, target);
    if (sim > best.sim) best = { seg: s, sim };
  }
  return best;
}

/** How well a domain's label matches the organisation name (e.g. "akshayapatra" ~ "Akshaya Patra"). */
export function domainMatch(domain: string, name: string): number {
  const label = domain.split(".")[0].replace(/[^a-z0-9]/g, "");
  const joined = tokens(name).join("");
  const joinedAll = normalizeName(name).replace(/\s+/g, "");
  if (!label || !joined) return 0;
  if (label === joined || label === joinedAll) return 1;
  if (label.includes(joined) || (joined.length >= 6 && joined.includes(label) && label.length >= 6)) return 0.9;
  return dice(label, joined);
}

function locationScore(location: string | undefined, texts: string[]): { score: number; hits: string[] } {
  if (!location) return { score: 0.5, hits: [] };
  const toks = tokens(location, { dropStop: true }).filter((t) => t.length >= 3);
  if (!toks.length) return { score: 0.5, hits: [] };
  const hay = normalizeName(texts.join(" "));
  const hits = toks.filter((t) => new RegExp(`\\b${t}\\b`).test(hay));
  return { score: hits.length / toks.length, hits };
}

/** Group raw search results into candidate organisations. */
export function buildCandidates(query: IdentityQuery, results: SearchResult[]): Candidate[] {
  const clusters = new Map<string, SearchResult[]>();
  const directory: SearchResult[] = [];

  for (const r of results) {
    const kind = classifyUrl(r.url, r.title);
    if (kind === "SOCIAL" || kind === "NEWS" || kind === "GENERIC" || kind === "GOVERNMENT_REGISTRY") continue;
    if (kind === "DIRECTORY") {
      directory.push(r);
      continue;
    }
    const domain = registrableDomain(r.url);
    if (!domain) continue;
    clusters.set(domain, [...(clusters.get(domain) ?? []), r]);
  }

  const candidates: Candidate[] = [];

  for (const [domain, rs] of clusters) {
    const texts = rs.flatMap((r) => [r.title, r.snippet]);
    let bestName = { seg: rs[0].title, sim: 0 };
    for (const r of rs) {
      const b = bestTitleSegment(r.title, query.name);
      if (b.sim > bestName.sim) bestName = b;
    }
    const snippetMentions = rs.some((r) => normalizeName(`${r.title} ${r.snippet}`).includes(normalizeName(query.name)));
    const nameScore = Math.max(bestName.sim, snippetMentions ? 0.85 : 0);
    const dm = domainMatch(domain, query.name);
    const loc = locationScore(query.location, texts);
    const support = Math.min(1, rs.length / 3);

    const score = query.location
      ? 0.45 * nameScore + 0.2 * dm + 0.25 * loc.score + 0.1 * support
      : 0.55 * nameScore + 0.3 * dm + 0.15 * support;

    const signals = [
      `Name similarity ${(nameScore * 100).toFixed(0)}% (“${bestName.seg}”)`,
      `Domain “${domain}” matches the name ${(dm * 100).toFixed(0)}%`,
      `${rs.length} search result${rs.length === 1 ? "" : "s"} on this domain`,
    ];
    if (query.location) signals.push(loc.hits.length ? `Location terms found in results: ${loc.hits.join(", ")}` : `None of the location terms (“${query.location}”) appear in this domain's results`);

    const home = rs.map((r) => r.url).find((u) => { try { return new URL(u).pathname.replace(/\/$/, "") === ""; } catch { return false; } });
    candidates.push({
      key: domain,
      name: bestName.seg || domain,
      domain,
      website: home ? canonicalUrl(home) : `https://${hostOf(rs[0].url) ?? domain}`,
      locationHints: loc.hits,
      evidenceUrls: rs.map((r) => canonicalUrl(r.url)),
      score: Number(score.toFixed(3)),
      signals,
      directoryOnly: false,
    });
  }

  // Directory listings → their own candidates (no auditable website), capped so a real site outranks them.
  for (const r of directory) {
    const b = bestTitleSegment(r.title, query.name);
    if (b.sim < 0.5) continue;
    const loc = locationScore(query.location, [r.title, r.snippet]);
    const raw = query.location ? 0.6 * b.sim + 0.4 * loc.score : b.sim;
    const key = `dir:${normalizeName(b.seg)}`;
    if (candidates.some((c) => c.key === key)) continue;
    candidates.push({
      key,
      name: b.seg,
      locationHints: loc.hits,
      evidenceUrls: [canonicalUrl(r.url)],
      score: Number(Math.min(0.6, raw * 0.7).toFixed(3)),
      signals: [`Listed in a third-party directory (${hostOf(r.url)}); no official website identified from this listing`],
      directoryOnly: true,
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

const RESOLVE_MIN = 0.62;
const GAP_MIN = 0.12;
const UNRESOLVED_MAX = 0.35;

export function resolveIdentity(candidates: Candidate[]): Resolution {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (!top || top.score < UNRESOLVED_MAX) return { status: "unresolved", candidates: sorted.slice(0, 5) };

  const second = sorted[1];
  const clearWinner = !second || top.score - second.score >= GAP_MIN;
  if (top.score >= RESOLVE_MIN && clearWinner) {
    return { status: "resolved", candidate: top, runnerUps: sorted.slice(1, 4), needsConfirmation: top.directoryOnly };
  }
  // Either two plausible entities, or a single weak match: a person must choose.
  const plausible = sorted.filter((c) => c.score >= UNRESOLVED_MAX && top.score - c.score < 0.3).slice(0, 5);
  return { status: "ambiguous", candidates: plausible.length ? plausible : [top] };
}
