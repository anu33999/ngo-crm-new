import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Access gate + basic request hygiene for every page and API route.
 *
 *  - APP_ACCESS_PASSWORD set  → HTTP Basic auth is required (any username; the username is recorded as the actor).
 *  - not set, development     → open (local use).
 *  - not set, production      → refused (503) unless ALLOW_UNAUTHENTICATED=true — this tool holds prospect research
 *                               and outreach drafts and must not be public by accident.
 *  - state-changing requests must be same-origin (blocks cross-site form posts riding on the browser's Basic-auth).
 */

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const headers = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

export function proxy(req: NextRequest) {
  const password = process.env.APP_ACCESS_PASSWORD;
  const isProd = process.env.NODE_ENV === "production";

  if (!password && isProd && process.env.ALLOW_UNAUTHENTICATED !== "true") {
    return new NextResponse("Access is not configured. Set APP_ACCESS_PASSWORD (or ALLOW_UNAUTHENTICATED=true for a private network).", { status: 503, headers });
  }

  if (password) {
    const auth = req.headers.get("authorization") ?? "";
    let ok = false;
    if (auth.startsWith("Basic ")) {
      try {
        const decoded = atob(auth.slice(6));
        const pass = decoded.slice(decoded.indexOf(":") + 1);
        ok = decoded.includes(":") && safeEqual(pass, password);
      } catch { ok = false; }
    }
    if (!ok) return new NextResponse("Authentication required.", { status: 401, headers: { ...headers, "www-authenticate": 'Basic realm="Kreatif Atelier NGO Intelligence", charset="UTF-8"' } });
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const site = req.headers.get("sec-fetch-site");
    const origin = req.headers.get("origin");
    const sameOrigin = !origin || new URL(origin).host === req.headers.get("host");
    if ((site && site !== "same-origin" && site !== "none") || !sameOrigin) {
      return new NextResponse("Cross-site requests are not allowed.", { status: 403, headers });
    }
  }

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
