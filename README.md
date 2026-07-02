# SIFUP

SIFUP is a football group dashboard for managing match operations, players, payments, and results. Most views are public/read-only; admin login is only required for edits, importing WhatsApp lists, mutating payments, and seeing player phone/WhatsApp contact links. It runs as a Next.js App Router + TypeScript + Tailwind app and persists shared data in Supabase/Postgres through `DATABASE_URL`.

## Setup

```bash
npm install
npm run db:setup
npm run dev
```

Open `http://localhost:3000`.

## Scripts

```bash
npm run dev
npm run dev:safe
npm run dev:doctor
npm run dev:stop:dry
npm run dev:stop
npm run build
npm run start
npm run db:schema
npm run db:seed
npm run db:setup
```

Use `npm run dev:safe` on Windows when working locally. It starts Next.js through a small process-tree wrapper, so closing the command also stops child workers that can otherwise keep running in the background. If local builds become slow, run `npm run dev:doctor` to list Node processes and memory usage, then `npm run dev:stop:dry` to preview SIFUP dev processes that would be closed. `npm run dev:stop` only targets this repo's Next dev processes by default; pass `-IncludePlaywrightMcp` to `scripts/stop-node-dev.ps1` manually only when those browser MCP sessions are known to be disposable.

## Environment

Copy `.env.example` to `.env.local` and set:

- `SIFUP_ADMIN_PASSWORD`: admin password used by the login form.
- `SESSION_SECRET`: secret used to sign the session cookie.
- `DATABASE_URL`: Supabase/Postgres connection string used by the server data repository.

Without `SESSION_SECRET`, local development falls back to a dev-only default, but production should always set it explicitly. Without `DATABASE_URL`, public pages fall back to the bundled seed data so builds still work, but admin mutations require a real database.

Public users can open the dashboard, matches, payments, players, and standings without logging in. Phone numbers and WhatsApp links only render after admin login.

## Deployment

For Vercel:

- Set `SIFUP_ADMIN_PASSWORD`, `SESSION_SECRET`, and `DATABASE_URL` in Project Settings.
- Use the default Next.js build flow; `npm run build` is the local equivalent.
- `npm run start` is only for local production testing after a build.
- Run `npm run db:setup` locally against the Supabase `DATABASE_URL` before using production, or run `npm run db:schema` and `npm run db:seed` separately.

## Migration Notes

The current schema is intentionally small and maps directly to the MVP types:

- `players`: name, nickname, private phone, active flag, skill level, and `payment_plan`.
- `matches`: date, time, location, week label, month key, status, court cost, and prepaid flag.
- `match_players`: attendance, team, per-match payment status, due/paid amounts, notes, and optional linked player.
- `match_results`: score and winner.
- `monthly_payments`: monthly $20.000 tracking by player/month.
- `club_finances`: court cost, prepaid court count, total prepaid amount, and transfer account.

Future Supabase work can add RLS, audit logs, normalized account settings, and migration tooling. For the MVP, database access stays server-only through `src/lib/repository.ts`, which can be replaced later without changing most UI components.

## Vega MCP Note

I attempted to review Vega MCP docs at `vega.mgranado.com/mcp`, but the endpoint requires an authentication token in this environment, so the documentation here is based on local code inspection.
