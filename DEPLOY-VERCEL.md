# Deploying to Vercel

This folder is ready for Vercel. Compared with the local copy it:

- uses **PostgreSQL** instead of SQLite (Vercel cannot keep a SQLite file),
- has a `vercel-build` step (`scripts/vercel-build.mjs`) that, on every deploy, creates/updates the database tables,
  loads the catalogue, packages and the 276-NGO directory (safe to repeat: nothing you edit in the app is overwritten),
  checks the data, then builds the app,
- has a `.vercelignore` so `.env` files, local databases and `node_modules` are never uploaded.

Vercel has no "upload a zip" button, so the simplest route is the Vercel command-line tool (no GitHub needed).

## 1. Upload the files (first deploy)

In Terminal:

```bash
cd ~/Downloads/kreatif-ngo-vercel
npx vercel
```

- It opens the browser to log in to Vercel.
- *Set up and deploy?* → **Y**. *Which scope?* → your account. *Link to existing project?* → **N**.
  *Project name?* → e.g. `kreatif-ngo`. *In which directory is your code?* → **./** . Accept the detected Next.js settings.

**This first build is expected to fail** with "DATABASE_URL is not set" — the database is connected in the next step.

## 2. Add the database

On vercel.com, open the project → **Storage** → **Create Database** → **Neon** (free plan is enough) →
pick region **Mumbai (ap-south-1)** if offered → **Connect** it to the project for all environments.
Vercel adds `DATABASE_URL` (and `DATABASE_URL_UNPOOLED`) to the project for you.

Optional but faster: project → **Settings → Functions → Function Region** → **Mumbai (bom1)**, so the app runs next to the database.

## 3. Add the settings

1. Open `.env.vercel` in this folder (it is hidden: in Finder press **Cmd + Shift + .**).
   It already contains your TinyFish and PageSpeed keys.
2. Type a password between the quotes of `APP_ACCESS_PASSWORD=""`. **Required** — without it the site refuses to open.
   Optionally fill `SENDER_NAME` / `SENDER_ROLE` (used to sign outreach drafts) and `ANTHROPIC_API_KEY`.
3. Project → **Settings → Environment Variables** → paste the whole file into the first *Key* box
   (Vercel splits it into separate variables) → tick all environments → **Save**.

## 4. Deploy for real

```bash
npx vercel --prod
```

The build log shows: *Creating/updating the database tables → Loading data → ALL CHECKS PASSED → Building the app*.
Open the URL it prints. The browser asks for a username and password: **any username** (it is recorded as who made each
edit) and the `APP_ACCESS_PASSWORD` you chose.

Later updates: change files here, run `npx vercel --prod` again.

## 5. Copy your local research into the online app (once)

This copies everything from your local app: audits, research history, CRM statuses, notes, pitch drafts, the activity log.
Do it right after step 4, **before the team starts using the online app**: the online database becomes an exact copy of
your local one, so anything added online before this is replaced.

```bash
cd ~/Downloads/kreatif-ngo-vercel
npm install
npx vercel env pull .env.local
node scripts/copy-local-data.mjs ~/Downloads/kreatif-ngo-latest/kreatif-ngo-platform/prisma/dev.db
```

That last command is a dry run: it shows how many NGOs, research jobs and notes will be copied and changes nothing.
If the numbers look right, run it again with `--replace` at the end:

```bash
node scripts/copy-local-data.mjs ~/Downloads/kreatif-ngo-latest/kreatif-ngo-platform/prisma/dev.db --replace
```

It runs as one transaction (all or nothing) and finishes with "✓ Copied". Refresh the online app to see your data.
Your local database is only read, never changed. Later deploys keep the copied data.

## Good to know

- After step 5, work in the online app: later changes in the local app are not synced (running step 5 again would
  overwrite the online data with the local copy).
- **Audit length:** audits run in the background for up to 300 seconds per request. That is within Vercel's current
  Hobby limit with Fluid compute (on by default for new projects); if an audit is cut off it is marked failed and can be retried.
- Keep `.env.vercel` private (it holds your API keys). It is excluded from uploads and from Git.
- Local development of *this* folder needs a Postgres `DATABASE_URL` in a `.env` file; keep using
  `~/Downloads/kreatif-ngo-latest/kreatif-ngo-platform` (SQLite) for local work.
