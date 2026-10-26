#!/usr/bin/env node
// Switch the Prisma datasource from SQLite to PostgreSQL.
// SQLite and PostgreSQL migrations are not interchangeable, so the existing migration
// folder is archived and you generate a fresh PostgreSQL baseline.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const schemaPath = path.join(root, "prisma", "schema.prisma");
const migrations = path.join(root, "prisma", "migrations");
const archive = path.join(root, "prisma", "migrations_sqlite");

let schema = fs.readFileSync(schemaPath, "utf8");
if (!/provider\s*=\s*"sqlite"/.test(schema)) {
  console.error('schema.prisma datasource is not "sqlite" — nothing to do.');
  process.exit(1);
}
schema = schema.replace(/(datasource db \{\s*provider\s*=\s*)"sqlite"/, '$1"postgresql"');
fs.writeFileSync(schemaPath, schema);

if (fs.existsSync(migrations)) {
  if (fs.existsSync(archive)) {
    console.error(`${archive} already exists — move it away first.`);
    process.exit(1);
  }
  fs.renameSync(migrations, archive);
  console.log(`Archived SQLite migrations to prisma/migrations_sqlite/`);
}
console.log(`
Datasource switched to PostgreSQL. Next:
  1. Set DATABASE_URL to your Postgres connection string in .env
  2. npm run db:setup     # creates the Postgres baseline migration, seeds and verifies
`);
