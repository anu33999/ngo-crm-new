# Database

## Local development (SQLite)

```bash
cp .env.example .env          # DATABASE_URL="file:./dev.db"
npm install
npm run db:setup              # prisma migrate dev --name init  →  seed  →  verify
```

`db:setup` creates `prisma/migrations/*_init`, seeds the catalogue and packages from
`prisma/seed-data/*.json`, then runs `scripts/verify-seed.ts`, which asserts:

- 206 services across 11 practice areas, with the per-area counts printed on the PDF contents page
- 3 tiers: Silver ₹15,000, Gold ₹25,000, Platinum ₹40,000 per month, excl. GST
- 40 add-on / setup / project rows from the workbook
- every service has a pricing-eligibility rule under the (draft) reference policy
- internal delivery economics live only in `PackageInternalEconomics` / `InternalAssumption`

## Regenerating seed data from ./reference

```bash
pip install pdfplumber openpyxl
npm run ingest                # python3 -I scripts/ingest_reference.py
```

The ingester is strict: it exits non-zero on any count or price mismatch, unknown service
code, or hours that do not add up. The generated JSON files are committed, so seeding itself
needs only Node.

## Moving to PostgreSQL

```bash
npm run db:use-postgres       # switches the datasource provider, archives SQLite migrations
# set DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/kreatif_ngo?schema=public" in .env
npm run db:setup
```

The schema avoids scalar lists and `@db.*` native types so the same models work on both
providers (list-like values are `Json`). Migrations are provider-specific, which is why the
SQLite set is archived rather than reused.

## Data handling notes

- `PackageInternalEconomics`, `InternalAssumption`: **internal only** — never select them in
  client-facing queries or exports.
- `PricingPolicy`: the seeded policy is a **DRAFT reference** of the workbook list prices.
  The planned NGO-support (subsidized / maintenance-only) policy is intentionally not
  seeded; no price is quoted until a person approves a policy.
- Deleting an `Ngo` cascades to its jobs, evidence, findings, recommendations, pitches,
  proposals and exports (data-deletion control).
