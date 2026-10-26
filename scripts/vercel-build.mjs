#!/usr/bin/env node
/**
 * Vercel build (Vercel runs the "vercel-build" script instead of "build" when it exists):
 *  1. generates the database client, 2. creates/updates the Postgres tables (prisma db push — refuses to drop data),
 *  3. loads the catalogue, packages and the 276-NGO directory (safe to repeat: keeps everything edited in the app),
 *  4. verifies the data, 5. builds the app.
 * Schema changes and seeding use the direct (unpooled) connection when the database integration provides one.
 */
import { spawnSync } from "node:child_process";

const env = process.env;
if (!env.DATABASE_URL) {
  console.error("\n  ✗ DATABASE_URL is not set. In Vercel open Storage → connect a Postgres (Neon) database to this project, then redeploy.\n");
  process.exit(1);
}
if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) {
  console.error("\n  ✗ DATABASE_URL must be a postgres:// or postgresql:// connection string.\n");
  process.exit(1);
}
const direct = env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || env.DIRECT_URL || env.DATABASE_URL;
const directEnv = { ...env, DATABASE_URL: direct };

function run(label, cmd, args, childEnv = env) {
  console.log(`\n▸ ${label}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", env: childEnv });
  if (r.error || r.status !== 0) {
    console.error(`\n  ✗ ${label} failed.\n`);
    process.exit(r.status || 1);
  }
}

run("Generating the database client", "npx", ["prisma", "generate"]);
run("Creating/updating the database tables", "npx", ["prisma", "db", "push", "--skip-generate"], directEnv);
run("Loading data", "npx", ["tsx", "prisma/seed.ts"], directEnv);
run("Verifying data", "npx", ["tsx", "scripts/verify-seed.ts"], directEnv);
run("Building the app", "npx", ["next", "build"]);
