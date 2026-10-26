import { NextResponse } from "next/server";
import { InputError } from "@/lib/research/runner";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Wrap a handler: known input errors become 400/404/429, anything else a generic 500 (details go to the server log only). */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof InputError) return json({ error: e.message }, 400);
    console.error("[api]", e);
    const hint = fixHint(e);
    // On your own machine (npm run dev) show the real cause so it can be fixed; in production keep details in the log only.
    if (process.env.NODE_ENV !== "production") {
      const msg = e instanceof Error ? e.message.replace(/\s+/g, " ").trim().slice(0, 600) : String(e).slice(0, 600);
      return json({ error: `${hint ? `${hint} — ` : ""}Server error: ${msg}` }, 500);
    }
    return json({ error: hint ?? "Something went wrong on the server. Check the server log for details." }, 500);
  }
}

/** Plain-language fixes for the setup problems that show up most often. */
export function fixHint(e: unknown): string | null {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (/did not initialize yet|prisma generate|Cannot find module '\.prisma|@prisma\/client/i.test(m)) return "The database client is not generated. In the project folder run: npx prisma generate — then restart npm run dev";
  if (/does not exist in the current database|no such table|no such column|Unknown (argument|field)|P2021|P2022/i.test(m)) return "The database is older than the app. In the project folder run: npx prisma migrate dev — then restart npm run dev";
  if (/Environment variable not found: DATABASE_URL|DATABASE_URL/i.test(m)) return "DATABASE_URL is missing. Run: cp .env.example .env — then restart npm run dev";
  if (/Can't reach database server|P1001|unable to open database file|SQLITE_CANTOPEN/i.test(m)) return "The database file cannot be opened. Run: npm run db:setup — then restart npm run dev";
  return null;
}

const MAX_BODY = 64 * 1024;

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, "Request body too large.");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "Request body too large.");
  if (!text.trim()) return {} as T;
  try {
    const v = JSON.parse(text);
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new HttpError(400, "The request body must be a JSON object.");
  }
}

/** Who is acting: the Basic-auth username if present, otherwise "local". Recorded in the audit log. */
export function actorOf(req: Request): string {
  const h = req.headers.get("authorization");
  if (h?.startsWith("Basic ")) {
    try {
      const user = atob(h.slice(6)).split(":")[0];
      if (user) return user.slice(0, 80);
    } catch { /* fall through */ }
  }
  return "local";
}

// Simple fixed-window limiter, per server instance. It protects paid search calls from accidental loops;
// it is not a substitute for a shared limiter if you run many instances.
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); return; }
  if (++b.n > limit) throw new HttpError(429, `Too many requests. Try again in ${Math.ceil((b.reset - now) / 60000)} minute(s).`);
}
export function resetRateLimits() { buckets.clear(); }

export function isHttpUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 2000) return false;
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}
