# SIFUP

SIFUP is a football group dashboard for managing match operations, players, payments, and results. Most views are public/read-only; admin login is only required for edits, importing WhatsApp lists, mutating payments, and seeing player phone/WhatsApp contact links. It currently runs as a Next.js App Router + TypeScript + Tailwind app and persists state in browser `localStorage` for now.

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Scripts

```bash
npm run dev
npm run build
npm run start
```

## Environment

Copy `.env.example` to `.env.local` and set:

- `SIFUP_ADMIN_PASSWORD`: admin password used by the login form.
- `SESSION_SECRET`: secret used to sign the session cookie.

Without `SESSION_SECRET`, local development falls back to a dev-only default, but production should always set it explicitly.

Public users can open the dashboard, matches, payments, players, and standings without logging in. Phone numbers and WhatsApp links only render after admin login.

## Deployment

For Vercel:

- Set `SIFUP_ADMIN_PASSWORD` and `SESSION_SECRET` in Project Settings.
- Use the default Next.js build flow; `npm run build` is the local equivalent.
- `npm run start` is only for local production testing after a build.
- Because the app currently stores data in `localStorage`, a Vercel deployment is stateless across browsers and devices.

## Migration Notes

The current data layer is local/mock data in the browser. A future Supabase/Postgres migration should replace `localStorage` persistence with server-backed storage and move any shared state to a real database before adding multi-user workflows.

## Vega MCP Note

I attempted to review Vega MCP docs at `vega.mgranado.com/mcp`, but the endpoint requires an authentication token in this environment, so the documentation here is based on local code inspection.
