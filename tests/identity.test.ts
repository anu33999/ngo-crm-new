import { describe, expect, it } from "vitest";
import { buildCandidates, resolveIdentity } from "@/lib/research/identity";
import { AMBIGUOUS_RESULTS, CLEAR_RESULTS, NOTHING_RELEVANT } from "./fixtures/search-results";

describe("identity resolution", () => {
  it("resolves a single clear organisation and points at its official domain", () => {
    const cands = buildCandidates({ name: "Asha Kiran Foundation", location: "Hyderabad" }, CLEAR_RESULTS);
    const res = resolveIdentity(cands);
    expect(res.status).toBe("resolved");
    if (res.status !== "resolved") return;
    expect(res.candidate.domain).toBe("ashakiranfoundation.org");
    expect(res.candidate.website).toBe("https://ashakiranfoundation.org");
    expect(res.candidate.signals.join(" ")).toMatch(/Location terms found/);
    expect(res.needsConfirmation).toBe(false);
  });

  it("does not treat social, news or directory pages as the official website", () => {
    const cands = buildCandidates({ name: "Asha Kiran Foundation" }, CLEAR_RESULTS);
    const domains = cands.map((c) => c.domain).filter(Boolean);
    expect(domains).toEqual(["ashakiranfoundation.org"]);
    expect(cands.find((c) => c.directoryOnly)?.score).toBeLessThanOrEqual(0.6);
  });

  it("asks for disambiguation when two different NGOs share a name and no location is given", () => {
    const res = resolveIdentity(buildCandidates({ name: "Hope Foundation" }, AMBIGUOUS_RESULTS));
    expect(res.status).toBe("ambiguous");
    if (res.status !== "ambiguous") return;
    expect(res.candidates.map((c) => c.domain).sort()).toEqual(["hopefoundation.org.in", "hopefoundationkolkata.in"]);
  });

  it("uses the location to separate similarly named organisations", () => {
    const res = resolveIdentity(buildCandidates({ name: "Hope Foundation", location: "Hyderabad, Telangana" }, AMBIGUOUS_RESULTS));
    expect(res.status).toBe("resolved");
    if (res.status === "resolved") expect(res.candidate.domain).toBe("hopefoundation.org.in");
  });

  it("reports 'unresolved' (never invents an organisation) when nothing plausible is found", () => {
    const res = resolveIdentity(buildCandidates({ name: "Asha Kiran Foundation" }, NOTHING_RELEVANT));
    expect(res.status).toBe("unresolved");
    expect(resolveIdentity([]).status).toBe("unresolved");
  });
});
