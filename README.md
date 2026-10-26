# Kreatif Atelier — NGO Intelligence, Regional Discovery & CRM Platform

An internal tool for the Kreatif Atelier team. It researches an NGO from public sources, audits its digital presence
with evidence for every claim, matches the gaps to the service catalogue, and drafts outreach for a person to review.
**Nothing is ever sent automatically.** It also keeps a Hyderabad & Secunderabad directory, an outreach CRM and a map of
who you have and have not reached.

Stack: Next.js 16 (App Router) · TypeScript · Tailwind v4 · Prisma (SQLite locally, PostgreSQL in production) ·
react-leaflet · exceljs · @react-pdf/renderer. Reference inputs (service catalogue PDF, NGO packages workbook) live in `./reference`.

## The six tabs

| Tab | What it is for |
| --- | --- |
| **Search & Audit** | Type an NGO name (and city). Identity is resolved first; if the name is ambiguous the run stops and asks you which organisation you mean. Then a 7-stage audit runs and opens the dashboard: What They Have, What They Lack, What We Can Improve, pitch drafts. |
| **Search History** | Every NGO already audited, with a location filter built from the database, instant search by name or cause, a website-status pill, readiness / opportunity pills and a Contacted badge. **Reopen audit** shows the saved result without fetching anything; **Refresh intelligence** re-runs it in the background. |
| **Twin-Cities Discovery** | 276 Hyderabad & Secunderabad NGOs (248 from the team's Asraya spreadsheet + 28 from NGO Darpan listings). Filter by city, area, category, priority, Darpan, contacted; tick rows to *Add to Outreach CRM*, *Mark as contacted* or *Run deep audit*. Contacted checkbox, phone and website edit inline; **Details & notes** opens every field for editing (email, Instagram, contact person, designation, address, priority, last contacted, next action, profile text, notes, activity log). **Import spreadsheet** adds more from .xlsx/.csv with a preview first. |
| **Outreach CRM** | "My searched NGOs": editable phone (tap-to-call), website, contact status (Not contacted / Contacted / Follow-up scheduled), interest (Pending / Interested / Uninterested / Contract signed), autosaving notes with an activity log, a 2-line pitch summary that opens the full 8-format pitch, *Copy WhatsApp pitch*, *Download proposal PDF*. |
| **Map** | Leaflet map centred on the twin cities. Pins: emerald = contacted, amber = follow-up scheduled, rose = not reached. Filters (all / reached / not reached), zoom to either city, popups with *Toggle contacted* and *View pitch summary*. |
| **Export & Settings** | CSV / Excel / PDF of the CRM, and the pricing policy (draft → approve). |

One client-side data store feeds all of them, so a status changed in the CRM, on the Map popup or in Discovery appears in
the other two immediately (optimistic update, written to the database in order, rolled back with a message if the save fails).

## Quick start

```bash
cp .env.example .env            # DATABASE_URL="file:./dev.db" is enough to start
npm install
npm run db:setup                # migrate → seed (catalogue, packages, 28-NGO directory) → verify
npm run dev                     # http://localhost:3000
```

No database yet and just want a look? `RESEARCH_STORE=memory npm run dev` keeps everything in RAM (nothing persists).

**Search and API keys.** No key is required: without one, audits use a keyless DuckDuckGo fallback and are labelled
"REDUCED RESEARCH" (fewer results, rate-limited, thinner identity/social/third-party coverage). For full-depth research add a
search key (`TINYFISH_API_KEY` — free up to 12,000 searches/day — or `TAVILY_API_KEY`; or `BRAVE_SEARCH_API_KEY`, or a Google CSE key + engine ID) and use "Refresh
intelligence" on anything audited in reduced mode. NGOs with a website on record can be audited even with search switched off.
`ANTHROPIC_API_KEY` and `PAGESPEED_API_KEY` are optional (see `.env.example`).

| Command | What it does |
| --- | --- |
| `npm run ingest` | Re-parse `./reference` into `prisma/seed-data/*.json` (strict: fails on any count/price mismatch) |
| `npm run db:setup` / `db:seed` / `db:verify` | Migrate + seed + verify / re-seed / check seeded data against the reference facts |
| `npm test` · `npm run lint` · `npm run typecheck` · `npm run build` | Checks |

## How it works

```
 name (+city) ──► 1 identify ──► 2 discover ──► 3 public sources ──► 4 audit ──► 5 opportunities ──► 6 match ──► 7 pitch
                    │ ambiguous?     search         registries,         site fetch      rank gaps          catalogue    8 drafts
                    └─► asks a person               social, news        (robots.txt     (impact, urgency,   + pricing    (deterministic,
                                                                         respected)      confidence, effort) policy       optionally polished by Claude)
                                      every finding carries evidence URLs, a state, and a confidence
 results ──► ResearchStore (Prisma | memory) ──► NgoRecord ──► one client store ──► History / Discovery / CRM / Map
```

- **Findings use four states**: *Confirmed issue*, *Likely opportunity*, *Not found publicly*, *Unable to assess*. "Not found" never means "does not exist"; anything the audit could not look at (social posting, performance, brand, offline work) is "unable to assess".
- **Web content is untrusted.** Fetched pages and search snippets are treated as data, never as instructions. Fetching respects robots.txt, never logs in and never solves captchas; social platforms are not scraped.
- **Two modes, no leakage.** Internal views and exports carry scores and review notes. NGO-facing documents are built from reviewed content only, exclude rejected/excluded findings and unapproved recommendations, show a DRAFT notice while anything is unapproved, and are checked against a list of internal terms before they can be exported.
- **Pricing comes only from an approved policy.** Without one, every price reads "needs human approval". Editing a policy resets it to draft; approving records who approved it.
- **A directory record and an audit are one record.** Deep-auditing a directory NGO fills blank phone/website/summary/score fields and never overwrites something a person entered.

## The Hyderabad & Secunderabad directory — what it is and is not

**From your spreadsheet (248):** `reference/Asraya_HYD_NGO_list.xlsx` → `src/data/directory.asraya-hyderabad-secunderabad.json` (rebuild with `npx tsx scripts/build-directory.ts`). Values are kept exactly as listed; numbers that look incomplete (10 have 11 digits) show a "check" flag, and the one malformed email is kept in the entry's source note instead of being dropped. 41 entries whose address names a known locality get a neighbourhood pin; the rest sit at the city centre (approximate). Re-importing a sheet only fills empty fields and never changes contact status or anything typed in the app.

**From NGO Darpan (28):**

The 28 starter entries were read from public NGO Darpan listing pages on 21 Oct 2026 (`src/data/directory.hyderabad-secunderabad.json`).
Only what those pages show is included: name, registration number as listed, address, sectors. **Phone numbers, websites and emails are blank on purpose**:
the listing pages do not show them and the app will not invent them; a Deep Audit fills them from the NGO's own site.
"Darpan listed" means the name appears in that registry listing; it is not a check of current registration, FCRA or 80G status.

Map pins are **approximate**: neighbourhood centroids (or the city centre when only the city is known), spread slightly so pins do not stack. They show roughly where an NGO is, not its street address.
No entries were found for Secunderabad Cantonment or East Marredpally. *Discover more* (search-driven) and *Add an NGO* grow the list; discovered entries are added only after a person confirms them.

## Adding or changing catalogue services

1. Update the PDF/workbook in `./reference` (or edit the generated JSON deliberately).
2. `npm run ingest` — fails loudly on unknown codes, count mismatches or hours that do not add up.
3. `npm run db:seed` — upserts services, tiers, add-ons and the reference policy rules.
4. Matching rules (which findings suggest which service, and which services are "do not pitch" without evidence) live in `src/lib/research/match.ts`; add a rule there and a test in `tests/gaps-match-scoring.test.ts`.

## Deploying

Set `APP_ACCESS_PASSWORD` first — in production the app returns 503 until access is configured. Use PostgreSQL (`docs/DATABASE.md`), not SQLite, anywhere that is not a single machine.

- **Vercel**: add the env vars, set `DATABASE_URL` to a hosted Postgres, run `npm run db:deploy && npm run db:seed` once. Audits run after the response via `after()` with `maxDuration = 300` on the run route; check that your plan allows that duration, otherwise long audits will be cut off (the job is marked failed and can be retried).
- **Railway / any Node host**: `npm run build && npm run db:deploy && npm start`. A long-lived server has no duration limit.
- No Dockerfile is included.

## Known limitations

- **Not run in the build sandbox**: Prisma migrate/seed/verify and `PrismaResearchStore` (the sandbox cannot download Prisma's engines), and live search/fetch against real sites (no network keys). They are written to compile and are covered through the in-memory store, but run `npm run db:setup` and one real audit before relying on them.
- Directory entries are starters, unverified beyond the Darpan listing; verify an NGO before contacting it. Coordinates are approximate.
- Map tiles come from the public OpenStreetMap server, which is fine for light internal use but has a usage policy; use a tile provider for heavier traffic.
- PDF exports use a built-in Latin font: Telugu/Hindi text will not render in PDFs (CSV and Excel are fine).
- Social platforms restrict automated access, so profile existence comes from the NGO's own links and search results; follower counts and posting frequency are not assessed.
- Official registries (NGO Darpan, Income Tax, FCRA, MCA) are interactive or captcha-protected and are not queried automatically; each compliance item links to the portal for manual checking.
- Without `ANTHROPIC_API_KEY`, drafts are composed from templates plus evidence (safe, plainer). Without `SENDER_NAME`, drafts carry a `[[Your name]]` placeholder that must be replaced.

See `docs/DATABASE.md` for SQLite → PostgreSQL and data-handling notes.
