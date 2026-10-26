#!/usr/bin/env node
/**
 * Copy everything from the local SQLite database (research, audits, CRM statuses, notes, drafts, activity log,
 * pricing policy) into the online Postgres database, so the Vercel app starts exactly where local work left off.
 *
 *   node scripts/copy-local-data.mjs <path to local dev.db>            # dry run: shows what would be copied
 *   node scripts/copy-local-data.mjs <path to local dev.db> --replace  # does it
 *
 * The online database becomes an exact copy of the local one: whatever is online now is replaced.
 * It runs in one transaction, so it either finishes completely or changes nothing.
 * The Postgres address comes from DATABASE_URL_UNPOOLED / DATABASE_URL, or from .env.local (`npx vercel env pull .env.local`).
 * Needs Node 22.5+ (built-in SQLite reader) and `npm install` in this folder.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Prisma, PrismaClient } from "@prisma/client";

const [file, flag] = process.argv.slice(2);
if (!file || !fs.existsSync(file)) {
  console.error("Usage: node scripts/copy-local-data.mjs <path to local dev.db> [--replace]");
  process.exit(1);
}
const replace = flag === "--replace";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error("No Postgres address found. Run `npx vercel env pull .env.local` in this folder first (or set DATABASE_URL).");
  process.exit(1);
}

const sqlite = new DatabaseSync(path.resolve(file), { readOnly: true });
const prisma = new PrismaClient({ datasourceUrl: url });
const models = Prisma.dmmf.datamodel.models;
const table = (m) => m.dbName ?? m.name;
const accessor = (m) => m.name[0].toLowerCase() + m.name.slice(1);

// Parents before children, following each relation's foreign key.
const order = [];
const seen = new Set();
function visit(m, stack = new Set()) {
  if (seen.has(m.name)) return;
  if (stack.has(m.name)) throw new Error(`Relation cycle at ${m.name}`);
  stack.add(m.name);
  for (const f of m.fields) {
    if (f.kind === "object" && f.relationFromFields?.length && f.type !== m.name) visit(models.find((x) => x.name === f.type), stack);
  }
  seen.add(m.name);
  order.push(m);
}
models.forEach((m) => visit(m));

// SQLite stores dates as epoch milliseconds, booleans as 0/1 and Json as text.
function convert(f, v) {
  if (v === null || v === undefined) return undefined;
  switch (f.type) {
    case "DateTime": return new Date(typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v);
    case "Boolean": return v === 1 || v === true || v === "1" || v === "true";
    case "Json": return typeof v === "string" ? JSON.parse(v) : v;
    case "BigInt": return BigInt(v);
    case "Bytes": return Buffer.from(v);
    case "Int": return Number(v);
    case "Float": return Number(v);
    default: return v;
  }
}

function readRows(m) {
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table(m));
  if (!exists) return [];
  const scalars = m.fields.filter((f) => f.kind === "scalar" || f.kind === "enum");
  return sqlite.prepare(`SELECT * FROM "${table(m)}"`).all().map((row) => {
    const out = {};
    for (const f of scalars) {
      const v = convert(f, row[f.dbName ?? f.name]);
      if (v !== undefined) out[f.name] = v;
    }
    return out;
  });
}

const data = order.map((m) => ({ m, rows: readRows(m) }));
const online = Object.fromEntries(
  await Promise.all(["ngo", "researchJob", "crmNote"].map(async (k) => [k, await prisma[k].count()])),
);
const local = (name) => data.find((d) => d.m.name === name)?.rows.length ?? 0;

console.log("\n  Local → online");
console.log(`  NGOs           ${local("Ngo")} → replaces ${online.ngo}`);
console.log(`  Research jobs  ${local("ResearchJob")} → replaces ${online.researchJob}`);
console.log(`  CRM notes      ${local("CrmNote")} → replaces ${online.crmNote}`);
console.log(`  All tables     ${data.reduce((n, d) => n + d.rows.length, 0)} rows in ${data.length} tables`);

if (!replace) {
  console.log("\n  Dry run, nothing changed. Add --replace to copy (this replaces everything currently online).\n");
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.$transaction(
  async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${order.map((m) => `"${table(m)}"`).join(", ")} CASCADE`);
    for (const { m, rows } of data) {
      for (let i = 0; i < rows.length; i += 500) await tx[accessor(m)].createMany({ data: rows.slice(i, i + 500) });
    }
  },
  { timeout: 10 * 60 * 1000, maxWait: 60 * 1000 },
);

const after = await prisma.ngo.count();
console.log(`\n  ✓ Copied. The online database now has ${after} NGOs, ${await prisma.researchJob.count()} research jobs and ${await prisma.crmNote.count()} CRM notes.\n`);
await prisma.$disconnect();
