# Risansi Pump Selection — Project Handoff / Context

Everything needed to pick this project up on a new machine (or in a fresh Claude
Code session). The code is fully on GitHub; only secrets and a couple of
reference files live outside the repo.

## What this is
A **Next.js (App Router, React 19, TypeScript)** app for **PCP pump selection**.
The frontend and the backend (API routes) live in **one Next.js app at the repo
root**. It replaced an earlier Vite frontend + Python Azure Functions backend.

- **Repo:** https://github.com/farhan2312/risansi_pump_selection (branch `main`)
- **Live:** https://select.risansi.com (Vercel, auto-deploys on push to `main`)
- **DB:** Azure Postgres `cosmosdb1.postgres.database.azure.com` / db `Pump_Selector_and_testing`

## Architecture
- `src/app/` — pages (login `/`, `/dashboard`, `/projects`, `/pump-selection`,
  `/selection-summary`, `/admin/access-requests`) + API routes under `src/app/api/`.
- `src/lib/db/` — **Drizzle ORM** schema (`schema.ts`) + `pg` pool (`index.ts`).
  The app only *queries* the live DB; it does not run migrations.
- `src/lib/recommendation-engine.ts` — the PCP selection engine.
- `src/lib/auth.ts` — JWT (HS256, `jsonwebtoken`) + `bcryptjs`.
- `src/lib/ai-suggestions.ts` — optional Anthropic gap suggestions.
- Auth is client-side (JWT in `localStorage`); `AuthGuard` protects routes.

## Setup on a new machine
1. Install Node.js 20+, Git, VS Code.
2. `git clone https://github.com/farhan2312/risansi_pump_selection.git`
3. `cd risansi_pump_selection && npm install`
4. Create **`.env.local`** in the root (gitignored — copy the secret values from a
   password manager / the old machine):
   ```
   DB_HOST=cosmosdb1.postgres.database.azure.com
   DB_PORT=5432
   DB_NAME=Pump_Selector_and_testing
   DB_USER=Shambhavi
   DB_PASSWORD=********
   DB_SSLMODE=require
   JWT_SECRET=********            # 64-char hex; must match Vercel's value
   ANTHROPIC_API_KEY=********     # optional (AI report hints)
   ```
5. `npm run dev` → http://localhost:3000

## Workflow
- **Always work from a fresh clone** and **push to `main`** — Vercel auto-builds
  and deploys to select.risansi.com (~1–2 min). Local edits only affect
  `npm run dev` until pushed.
- Env vars in **Vercel** (Settings → Environment Variables, Production) are
  separate from local `.env.local`. The same `DB_*` + `JWT_SECRET` must be set
  there or the live site breaks.

## Deployment gotchas (already solved — don't reintroduce)
- **`JWT_SECRET` must be set in the Vercel dashboard**, not just locally — login
  500s without it.
- **Azure Postgres firewall** must allow Vercel's rotating IPs
  (`0.0.0.0`–`255.255.255.255`); "Allow Azure services" does not cover Vercel.
- **No root `vercel.json`** — a Next.js app at the repo root builds via
  framework auto-detection. An old one that built the deleted Vite app broke it.
- **Table `id`/`created_at` have no DB default** — Drizzle generates them in-app
  via `$defaultFn(() => crypto.randomUUID())` / `() => new Date()`. Do NOT use
  `.defaultRandom()` / `.defaultNow()` (NOT-NULL violation on insert).
- **DB pool is cached on `globalThis`** in all envs so Vercel reuses one pool.

## Recommendation engine (PCP only — ROTA out of scope)
Source of truth: `Pump Selection Chart_V7` sheet + the handwritten formulas.
- VE / ME / QTH read per (model, head) from `performance_curve` /
  `pump_model_master`.
- **RPM = 100 × capacity / (QTH × VE_max)** (sheet col N, "REQ RPM AT MAX VE").
  No viscosity factor on the PCP path (VF is ROTA-only). No VE averaging/clamp.
- **BKW = capacity × head / (367 × ME)**; installed motor = BKW × 1.2 rounded up
  to a standard kW (or the model's tested min kW if it already covers the margin).
- **Ranking / match score:** confidence score starting at 100, deducting for
  not-tested, head-point mismatch, drive complexity, and (dominant term) high
  required RPM — PCP pumps run best slow, so the lowest-sensible-RPM suitable
  pump ranks #1 and scores in the 90s.
- **Pending:** the user wanted "rank by closest to each model's *rated* RPM," but
  rated RPM per model isn't in the DB or the sheet yet. Revisit if that data
  arrives (load into `pump_model_master.rpm_min/rpm_max`).

## Design system
- Follows the **Risansi design guide** (`risansi-style.md`, kept outside the
  repo). Fonts: **IBM Plex Sans** (13px body), **IBM Plex Mono** (all numbers),
  **Instrument Serif** (accent) — loaded via `next/font` in `src/app/layout.tsx`.
- Tokens live in `src/styles/theme.css` (navy sidebar `#0A1628`, accent
  `#1A5CB8`, cyan `#00B4D8`, `--fg`/`--bg`/`--line`/`--title`, etc.).
- **TODO:** the design-guide recipes are applied to the shell, sidebar, and stat
  cards; still to convert screen-by-screen: pump-selection wizard forms, the
  recommendation/report tables (mono numbers), overlays, and the login page.

## Reference files (NOT in the repo — keep locally / OneDrive)
- `Pump Selection Chart_V7_26-05-2026.xlsx` — the pump formulas & master data.
- `risansi-style.md` — the full design guide.

## Accounts needed
GitHub (`farhan2312`, push access), Vercel (`farhan2312s-projects`), Azure
(Postgres server / firewall).
