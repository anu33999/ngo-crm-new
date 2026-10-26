/** Name / text helpers shared by identity resolution and discovery. Pure functions. */

const STOP_TOKENS = new Set(["the", "of", "and", "for", "ngo", "ngos", "official", "website", "home", "india"]);

export function stripDiacritics(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeName(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9ऀ-ൿ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string, opts: { dropStop?: boolean } = { dropStop: true }): string[] {
  const t = normalizeName(s).split(" ").filter(Boolean);
  return opts.dropStop ? t.filter((x) => !STOP_TOKENS.has(x)) : t;
}

function bigrams(s: string): string[] {
  const x = s.replace(/\s+/g, "");
  if (x.length < 2) return x ? [x] : [];
  const out: string[] = [];
  for (let i = 0; i < x.length - 1; i++) out.push(x.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice over character bigrams, 0..1. */
export function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of B) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      overlap++;
      counts.set(g, c - 1);
    }
  }
  return (2 * overlap) / (A.length + B.length);
}

/**
 * Similarity of two organisation names, 0..1. Token-set overlap dominates (so word order and
 * filler words do not matter) with a bigram-Dice term to forgive spelling variants.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const sb = new Set(tb);
  const inter = ta.filter((t) => sb.has(t)).length;
  const jaccard = inter / new Set([...ta, ...tb]).size;
  const containment = inter / Math.min(ta.length, tb.length);
  const d = dice(ta.join(" "), tb.join(" "));
  return Math.min(1, 0.45 * jaccard + 0.25 * containment + 0.3 * d);
}

/** True if every word of `needle` appears (as a whole word) in `haystack`. */
export function containsAllTokens(haystack: string, needle: string): boolean {
  const h = new Set(tokens(haystack, { dropStop: false }));
  const n = tokens(needle);
  return n.length > 0 && n.every((t) => h.has(t));
}

/** Trim and neutralise untrusted text before it is stored or sent to a model. */
export function cleanText(s: string, max = 2000): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
