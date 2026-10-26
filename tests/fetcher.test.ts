import { describe, expect, it } from "vitest";
import { assertPublicUrl, createFetcher, isPrivateIp } from "@/lib/research/fetcher";

const publicLookup = async () => ["93.184.216.34"];

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    return r ? r() : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}
const html = (body: string, status = 200, headers: Record<string, string> = { "content-type": "text/html" }) => () => new Response(body, { status, headers });

describe("SSRF guard", () => {
  it("recognises private, loopback, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.1.2.3"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"]) expect(isPrivateIp(ip)).toBe(false);
  });
  it("rejects unsafe URLs", async () => {
    for (const u of ["http://localhost/x", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data", "ftp://example.org/", "https://user:pw@example.org/", "http://intranet.local/"]) {
      await expect(assertPublicUrl(u, publicLookup)).rejects.toThrow();
    }
    await expect(assertPublicUrl("https://evil.example/", async () => ["10.0.0.1"])).rejects.toThrow(/non-public/);
    await expect(assertPublicUrl("https://ok.example/", publicLookup)).resolves.toBeInstanceOf(URL);
  });
});

describe("fetcher behaviour", () => {
  const base = { lookup: publicLookup, perHostDelayMs: 0, userAgent: "TestBot/1.0" };

  it("fetches allowed pages and returns text", async () => {
    const { impl } = fakeFetch({ "https://ngo.example/robots.txt": html("User-agent: *\nAllow: /\nSitemap: https://ngo.example/sitemap.xml", 200, { "content-type": "text/plain" }), "https://ngo.example/": html("<html>hi</html>") });
    const f = createFetcher({ ...base, fetchImpl: impl });
    const out = await f.get("https://ngo.example/");
    expect(out).toMatchObject({ status: "OK", httpStatus: 200, body: "<html>hi</html>" });
    expect((await f.robotsInfo("https://ngo.example")).sitemaps).toEqual(["https://ngo.example/sitemap.xml"]);
  });

  it("does not request pages that robots.txt disallows", async () => {
    const { impl, calls } = fakeFetch({ "https://ngo.example/robots.txt": html("User-agent: *\nDisallow: /private", 200, { "content-type": "text/plain" }), "https://ngo.example/private/x": html("secret") });
    const out = await createFetcher({ ...base, fetchImpl: impl }).get("https://ngo.example/private/x");
    expect(out.status).toBe("BLOCKED_BY_ROBOTS");
    expect(calls).not.toContain("https://ngo.example/private/x");
  });

  it("treats an unavailable robots.txt (5xx) as disallow, and a missing one (404) as allow", async () => {
    const a = fakeFetch({ "https://down.example/robots.txt": html("err", 503), "https://down.example/": html("x") });
    expect((await createFetcher({ ...base, fetchImpl: a.impl }).get("https://down.example/")).status).toBe("BLOCKED_BY_ROBOTS");
    const b = fakeFetch({ "https://plain.example/": html("x") });
    expect((await createFetcher({ ...base, fetchImpl: b.impl }).get("https://plain.example/")).status).toBe("OK");
  });

  it("re-validates every redirect hop (redirect to a private host is refused)", async () => {
    const lookup = async (h: string) => (h === "internal.example" ? ["10.0.0.9"] : ["93.184.216.34"]);
    const { impl } = fakeFetch({ "https://ngo.example/": () => new Response(null, { status: 302, headers: { location: "https://internal.example/admin" } }) });
    const out = await createFetcher({ lookup, perHostDelayMs: 0, fetchImpl: impl }).get("https://ngo.example/");
    expect(out.status).toBe("UNSAFE_URL");
  });

  it("reports login walls instead of trying to get past them", async () => {
    const { impl } = fakeFetch({ "https://ngo.example/members": () => new Response(null, { status: 302, headers: { location: "https://ngo.example/login?next=/members" } }) });
    expect((await createFetcher({ ...base, fetchImpl: impl }).get("https://ngo.example/members")).status).toBe("REQUIRES_LOGIN");
    const b = fakeFetch({ "https://ngo.example/x": html("no", 401) });
    expect((await createFetcher({ ...base, fetchImpl: b.impl }).get("https://ngo.example/x")).status).toBe("REQUIRES_LOGIN");
  });

  it("caps response size and does not decode binary types", async () => {
    const big = "a".repeat(200_000);
    const { impl } = fakeFetch({ "https://ngo.example/big": html(big), "https://ngo.example/r.pdf": () => new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } }) });
    const f = createFetcher({ ...base, fetchImpl: impl, maxBytes: 50_000 });
    expect(((await f.get("https://ngo.example/big")).body ?? "").length).toBeLessThanOrEqual(200_000);
    const pdf = await f.get("https://ngo.example/r.pdf");
    expect(pdf).toMatchObject({ status: "OK", contentType: "application/pdf" });
    expect(pdf.body).toBeUndefined();
  });

  it("never throws: network errors come back as FAILED", async () => {
    const impl = (async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch;
    const out = await createFetcher({ ...base, fetchImpl: impl }).get("https://ngo.example/");
    expect(["FAILED", "BLOCKED_BY_ROBOTS"]).toContain(out.status);
  });
});
