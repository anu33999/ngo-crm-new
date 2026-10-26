#!/usr/bin/env node
/**
 * One-command local setup:  npm run setup   (or  npm run go  = setup + start the app)
 *  1. checks Node, 2. repairs .env (keeps every key you added, fixes lines that were glued together, adds DATABASE_URL),
 *  3. generates the database client, 4. creates/updates the SQLite database (prisma db push — no prompts),
 *  5. loads the catalogue, packages and the 276-NGO directory, 6. verifies the data.
 * Safe to run any number of times: existing NGOs and everything you edited are kept.
 * If a step fails it stops, says which step, and writes the full output to setup-log.txt.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const logFile = path.join(root, "setup-log.txt");
fs.writeFileSync(logFile, `Setup log ${new Date().toISOString()}\n`);
const log = (s) => fs.appendFileSync(logFile, s + "\n");
const ok = (s) => console.log(`  ✓ ${s}`);
function fail(step, detail) {
  console.error(`\n  ✗ ${step} failed.\n`);
  if (detail) console.error(detail.split("\n").slice(-25).join("\n"));
  console.error(`\n  Full output saved to: ${logFile}\n  Send that file (or the lines above) and it can be fixed quickly.\n`);
  process.exit(1);
}

console.log("\nKreatif Atelier NGO platform — setup\n");

// 1. Node
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 20 || (maj === 20 && min < 9)) fail("Node version check", `Node ${process.versions.node} is too old. Install Node 20.9 or newer (e.g. brew install node), then run this again.`);
ok(`Node ${process.versions.node}`);

// 2. .env — parse robustly (handles glued lines like KEY="a"KEY2="b"), keep everything, ensure DATABASE_URL.
export function parseEnv(text) {
  const out = new Map();
  const re = /([A-Z][A-Z0-9_]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'#]*))/g;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*export\s+/, "");
    if (/^\s*#/.test(line) || !line.trim()) continue;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line))) out.set(m[1], m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}
const envPath = path.join(root, ".env");
const before = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const env = parseEnv(before);
if (!env.get("DATABASE_URL")) env.set("DATABASE_URL", "file:./dev.db");
if (env.get("TINYFISH_API_KEY") && !env.get("SEARCH_PROVIDER")) env.set("SEARCH_PROVIDER", "tinyfish");
const clean = [...env].map(([k, v]) => `${k}="${v.replace(/"/g, "")}"`).join("\n") + "\n";
if (clean !== before) {
  if (before) fs.writeFileSync(path.join(root, ".env.backup"), before);
  fs.writeFileSync(envPath, clean);
  ok(`.env repaired${before ? " (old version saved as .env.backup)" : " (created)"}: ${[...env.keys()].join(", ")}`);
} else ok(`.env is fine: ${[...env.keys()].join(", ")}`);

const childEnv = { ...process.env, ...Object.fromEntries(env) };
for (const k of Object.keys(childEnv)) if (childEnv[k] === "") delete childEnv[k];
childEnv.DATABASE_URL = env.get("DATABASE_URL");

function run(step, cmd, args) {
  log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: root, env: childEnv, encoding: "utf8", shell: process.platform === "win32", input: "" });
  const outp = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  log(outp);
  if (r.error || r.status !== 0) fail(step, `${r.error ? r.error.message + "\n" : ""}${outp}`);
  return outp;
}

// 3–6
if (!fs.existsSync(path.join(root, "node_modules", ".bin", "prisma"))) { console.log("  … installing packages (first run, takes a minute)"); run("npm install", "npm", ["install", "--no-audit", "--no-fund"]); ok("packages installed"); }
run("Generating the database client", "npx", ["prisma", "generate"]); ok("database client generated");
run("Creating/updating the database", "npx", ["prisma", "db", "push", "--skip-generate"]); ok("database ready (prisma/dev.db)");
const seed = run("Loading data", "npx", ["tsx", "prisma/seed.ts"]);
ok(seed.split("\n").filter((l) => /Seeded|Directory/.test(l)).join(" · ") || "data loaded");
run("Verifying data", "npx", ["tsx", "scripts/verify-seed.ts"]); ok("data verified");
const search = env.get("TINYFISH_API_KEY") || env.get("TAVILY_API_KEY") || env.get("BRAVE_SEARCH_API_KEY") ? "full depth" : "reduced (no search key — add TINYFISH_API_KEY to .env for full depth)";
console.log(`\n  All set. Web search: ${search}.\n`);
