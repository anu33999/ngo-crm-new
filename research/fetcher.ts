import dns from "node:dns/promises";
import net from "node:net";
import robotsParser from "robots-parser";
import { sleep } from "./limiter";

/**
 * Safe, polite fetching of third-party pages.
 *  - blocks private / loopback / link-local / metadata addresses (SSRF), re-checked on every redirect hop
 *  - honours robots.txt (RFC 9309: unavailable robots.txt (5xx / unreachable) = disallow)
 *  - never logs in, never bypasses paywalls, bot protection or login walls — it reports them
 *  - timeouts, response-size cap, per-host spacing, identifiable user agent
 */

export type FetchStatusKind = "OK" | "FAILED" | "BLOCKED_BY_ROBOTS" | "REQUIRES_LOGIN" | "TIMEOUT" | "UNSAFE_URL";

export interface FetchOutcome {
  requestedUrl: string;
  finalUrl?: string;
  status: FetchStatusKind;
  httpStatus?: number;
  contentType?: string;
  body?: string; // text bodies only (html/xml/plain/json), capped
  headers: Record<string, string>;
  ms?: number;
  bytes?: number;
  error?: string;
  redirects: string[];
}

export interface FetchDeps {
  fetchImpl?: typeof fetch;
  lookup?: (host: string) => Promise<string[]>;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  perHostDelayMs?: number;
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff");
  }
  return true; // not an IP we understand: refuse
}

const defaultLookup = async (host: string) => (await dns.lookup(host, { all: true })).map((r) => r.address);

/** Throws if the URL is not a public http(s) URL. */
export async function assertPublicUrl(raw: string, lookup = defaultLookup): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`unsupported protocol ${u.protocol}`);
  if (u.username || u.password) throw new Error("credentials in URL are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new Error("local hostnames are not allowed");
  const addrs = net.isIP(host) ? [host] : await lookup(host);
  if (!addrs.length) throw new Error("host did not resolve");
  if (addrs.some(isPrivateIp)) throw new Error("host resolves to a non-public address");
  return u;
}

const TEXTUAL = /^(text\/|application\/(xhtml\+xml|xml|json|ld\+json|rss\+xml|atom\+xml))/i;
const LOGIN_PATH = /(\/login|\/signin|\/sign-in|\/accounts\/login|\/checkpoint|\/authwall|\/uas\/login)/i;

export function createFetcher(deps: FetchDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;
  const timeoutMs = deps.timeoutMs ?? 15000;
  const maxBytes = deps.maxBytes ?? 1_500_000;
  const perHostDelayMs = deps.perHostDelayMs ?? 400;
  const userAgent =
    deps.userAgent ??
    `KreatifAtelierResearchBot/1.0 (+${process.env.APP_URL ?? "https://www.kreatifatelier.com"}; prospect research; respects robots.txt)`;

  const robotsCache = new Map<string, { parser: ReturnType<typeof robotsParser> | null; blockedReason?: string; sitemaps: string[]; found: boolean }>();
  const hostChain = new Map<string, Promise<void>>();

  async function politeWait(host: string, signal?: AbortSignal) {
    const prev = hostChain.get(host) ?? Promise.resolve();
    const mine = prev.then(() => sleep(perHostDelayMs, signal));
    hostChain.set(host, mine);
    await prev;
  }

  async function rawGet(url: string, signal?: AbortSignal, opts: { maxBytes?: number } = {}): Promise<FetchOutcome> {
    const started = Date.now();
    const redirects: string[] = [];
    let current = url;
    for (let hop = 0; hop <= 5; hop++) {
      let u: URL;
      try {
        u = await assertPublicUrl(current, lookup);
      } catch (e) {
        return { requestedUrl: url, status: "UNSAFE_URL", headers: {}, redirects, error: (e as Error).message };
      }
      await politeWait(u.hostname, signal);
      const timeout = AbortSignal.timeout(timeoutMs);
      const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await fetchImpl(u.toString(), {
          redirect: "manual",
          signal: sig,
          headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5", "accept-language": "en" },
        });
      } catch (e) {
        const aborted = timeout.aborted;
        return { requestedUrl: url, finalUrl: current, status: aborted ? "TIMEOUT" : "FAILED", headers: {}, redirects, error: aborted ? `timed out after ${timeoutMs}ms` : (e as Error).message, ms: Date.now() - started };
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) return { requestedUrl: url, finalUrl: current, status: "FAILED", httpStatus: res.status, headers: {}, redirects, error: "redirect without location" };
        current = new URL(loc, u).toString();
        redirects.push(current);
        if (LOGIN_PATH.test(new URL(current).pathname)) {
          return { requestedUrl: url, finalUrl: current, status: "REQUIRES_LOGIN", httpStatus: res.status, headers: {}, redirects, error: "redirected to a login page" };
        }
        continue;
      }
      const headers: Record<string, string> = {};
      for (const k of ["server", "content-type", "strict-transport-security", "x-frame-options", "content-security-policy", "x-content-type-options", "last-modified", "content-language"]) {
        const v = res.headers.get(k);
        if (v) headers[k] = v;
      }
      const contentType = res.headers.get("content-type") ?? undefined;
      const base = { requestedUrl: url, finalUrl: u.toString(), httpStatus: res.status, contentType, headers, redirects, ms: Date.now() - started };
      if (res.status === 401) return { ...base, status: "REQUIRES_LOGIN", error: "401 Unauthorized" };
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return { ...base, status: "FAILED", error: `HTTP ${res.status}` };
      }
      if (contentType && !TEXTUAL.test(contentType)) {
        await res.body?.cancel().catch(() => undefined);
        return { ...base, status: "OK", bytes: Number(res.headers.get("content-length") ?? 0) || undefined };
      }
      const cap = opts.maxBytes ?? maxBytes;
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        chunks.push(value);
        if (total >= cap) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
      const body = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
      return { ...base, status: "OK", body, bytes: total, ms: Date.now() - started };
    }
    return { requestedUrl: url, finalUrl: current, status: "FAILED", headers: {}, redirects, error: "too many redirects" };
  }

  async function robotsFor(origin: string, signal?: AbortSignal) {
    const cached = robotsCache.get(origin);
    if (cached) return cached;
    const out = await rawGet(`${origin}/robots.txt`, signal, { maxBytes: 300_000 });
    let entry: { parser: ReturnType<typeof robotsParser> | null; blockedReason?: string; sitemaps: string[]; found: boolean };
    if (out.status === "OK" && out.body !== undefined) {
      const parser = robotsParser(`${origin}/robots.txt`, out.body);
      entry = { parser, sitemaps: parser.getSitemaps(), found: true };
    } else if (out.httpStatus && out.httpStatus >= 400 && out.httpStatus < 500 && out.status !== "REQUIRES_LOGIN") {
      entry = { parser: null, sitemaps: [], found: false }; // no robots.txt → everything allowed
    } else if (out.status === "UNSAFE_URL") {
      entry = { parser: null, sitemaps: [], found: false, blockedReason: out.error };
    } else {
      entry = { parser: null, sitemaps: [], found: false, blockedReason: `robots.txt unavailable (${out.error ?? out.status}); treated as disallow per RFC 9309` };
    }
    robotsCache.set(origin, entry);
    return entry;
  }

  return {
    userAgent,
    /** Fetch a page, honouring robots.txt. Never throws. */
    async get(url: string, signal?: AbortSignal): Promise<FetchOutcome> {
      let origin: string;
      try {
        origin = new URL(url).origin;
      } catch {
        return { requestedUrl: url, status: "UNSAFE_URL", headers: {}, redirects: [], error: "invalid URL" };
      }
      const robots = await robotsFor(origin, signal);
      if (robots.blockedReason) return { requestedUrl: url, status: robots.blockedReason.startsWith("robots.txt") ? "BLOCKED_BY_ROBOTS" : "UNSAFE_URL", headers: {}, redirects: [], error: robots.blockedReason };
      if (robots.parser && robots.parser.isAllowed(url, userAgent) === false) {
        return { requestedUrl: url, status: "BLOCKED_BY_ROBOTS", headers: {}, redirects: [], error: "disallowed by robots.txt" };
      }
      return rawGet(url, signal);
    },
    /** robots.txt facts for an origin (found? sitemaps?). */
    async robotsInfo(origin: string, signal?: AbortSignal) {
      const r = await robotsFor(origin, signal);
      return { found: r.found, sitemaps: r.sitemaps, blockedReason: r.blockedReason };
    },
  };
}

export type Fetcher = ReturnType<typeof createFetcher>;
