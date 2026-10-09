# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Nomikai — a drink-counting app with leaderboards and different drinks to try. (Nomikai is Japanese for a drinking party.) Fun side project — keep things simple.

## Structure

- `web/` — Next.js (TypeScript, App Router, Tailwind). All data goes through the API, never through Supabase tables:
  `web/lib/api.ts` for client components, `web/lib/api-server.ts` for server components (`NEXT_PUBLIC_API_URL` in `web/.env.local`).
  supabase-js is only for auth (login, session, sign out) with the publishable key.
  Anything read in a client component goes through TanStack Query (`useQuery`/`useMutation` + `invalidateQueries`),
  not `useState` + `useEffect`. Provider lives in `web/app/providers.tsx`; `useState` is for form fields and UI toggles only.
- `api/` — NestJS (TypeScript) with Drizzle ORM (`api/drizzle.config.ts`, schema in `api/src/db/schema.ts`). Uses the secret key / direct DB connection (`api/.env`), listening on `PORT` (3001).
  It connects as `postgres` and so **bypasses RLS** — every endpoint authorizes for itself. `AuthGuard` verifies the Supabase
  JWT (ES256, via JWKS); friend visibility lives in `src/visibility.ts`; `StorageService` signs photo URLs onto the rows it returns.
  Postgres constraint violations are the validation layer: `PgErrorFilter` maps SQLSTATEs to 4xx and passes `code` through to the web app.
- `supabase/` — Supabase CLI config, migrations (schema starts with `profiles`), and auth email templates (`templates/otp.html`; hosted free tier ignores them until custom SMTP is configured).

## Commands

- `web/`: `npm run dev` (Turbopack), `npm run build`, `npm run lint`
- `api/`: `npm run start:dev`, `npm run build`, `npm run test`, `npm run test:e2e`
  (`test:e2e` drives every endpoint against the linked Supabase project with two throwaway users, and deletes them afterwards — it needs the API running)
- Supabase local stack: `supabase start` / `supabase stop` / `supabase db reset` (Docker required). Studio at http://127.0.0.1:54323, API at 54321, DB at 54322.
- Drizzle: edit `api/src/db/schema.ts`, then `npm run db:generate` from `api/`. Never `drizzle-kit push`/`migrate` —
  `drizzle/0000_baseline.sql` only records the schema as it already existed and is never executed. The Supabase CLI stays the
  only migration runner, so copy each generated file into `supabase/migrations/` and apply it with `supabase db push`.

## Supabase specifics

- Hosted project ref: `zcnjovwozgsxowijebgw` (AWS us-west-2). Secrets live in root `.env` (gitignored).
- The direct connection host `db.zcnjovwozgsxowijebgw.supabase.co` is IPv6-only and unreachable from this network. Use the IPv4 session pooler instead: `aws-0-us-west-2.pooler.supabase.com:5432`, user `postgres.zcnjovwozgsxowijebgw`.
- The Supabase CLI is logged in and linked to this project. Linked db commands still resolve the IPv6-only direct host, so prefer `--db-url` with the IPv4 pooler for db operations (e.g. `supabase db push --db-url "$SUPABASE_DB_URL"`).
- npm note: `~/.npm` contains root-owned files, so plain `npm install` fails. Either fix once with `sudo chown -R 501:20 ~/.npm` or set `npm_config_cache` to a writable dir.

## Browser testing

When you use the Playwright MCP, delete everything it writes once you're done:
the `.playwright-mcp/` folder (snapshots, console logs) and any screenshots or
images you saved. Check that the files are untracked before deleting them.
