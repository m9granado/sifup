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
- `SIFUP_MCP_TOKEN`: bearer token required by the private MCP endpoint.

Without `SESSION_SECRET`, local development falls back to a dev-only default, but production should always set it explicitly. Without `DATABASE_URL`, public pages fall back to the bundled seed data so builds still work, but admin mutations require a real database.

Public users can open the dashboard, matches, payments, players, and standings without logging in. Phone numbers and WhatsApp links only render after admin login.

## MCP

SIFUP exposes a private MCP endpoint at:

```text
https://sifup.vercel.app/mcp
```

Every MCP request must include:

```text
Authorization: Bearer <SIFUP_MCP_TOKEN>
```

Tools:

- `import_whatsapp_match`: imports a WhatsApp list into a match, replacing players/teams/payments. Pass `matchId` to update a specific match, or omit it to match by date and time.
- `add_player_to_match`: adds a single player to a match without touching the rest of the list, teams, or payments.
- `register_monthly_payment`: marks a player's monthly fee as paid/unpaid.
- `get_pending_payments`: lists who owes money (monthly fees and per-match balances) with totals.
- `get_next_match_summary`: returns the next match summary and copy-ready WhatsApp texts.

### OpenClaw / static bearer token clients

Clients that let you set a raw header can skip OAuth entirely:

```bash
openclaw mcp set sifup "{\"url\":\"https://sifup.vercel.app/mcp\",\"headers\":{\"Authorization\":\"Bearer <SIFUP_MCP_TOKEN>\"}}"
```

### claude.ai / ChatGPT (OAuth)

Consumer connector UIs (claude.ai, chatgpt.com) require OAuth discovery instead of a manual header. SIFUP implements a minimal single-user OAuth 2.1 shim that wraps the same `SIFUP_MCP_TOKEN`:

- `GET /.well-known/oauth-protected-resource` and `GET /.well-known/oauth-authorization-server`: discovery metadata.
- `POST /register`: dynamic client registration (RFC 7591). No storage — the issued `client_id` is a signed token encoding the client's `redirect_uris`.
- `GET/POST /authorize`: shows a password form (reuses `SIFUP_ADMIN_PASSWORD`); on success issues a short-lived authorization code (PKCE `S256` required) and redirects back to the client.
- `POST /token`: exchanges the code (or a `refresh_token`) for an access token, which is simply `SIFUP_MCP_TOKEN` itself.

Just add `https://sifup.vercel.app/mcp` as a custom connector in claude.ai or chatgpt.com; the client discovers and drives the OAuth flow automatically, prompting for the admin password once.

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
