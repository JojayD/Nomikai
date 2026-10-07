# Drink collection implementation plan

> Execute inline with the executing-plans skill; independent whole-branch review before shipping.

**Goal:** Implement Want to try and Drink passport end to end.
**Architecture:** One collection controller, one owner-scoped saved-drinks table,
and a collection page; passport derives from entries. Reuse logging and query invalidation.
**Tech stack:** NestJS, Drizzle/Postgres, Next.js, TanStack Query, Jest/Vitest.
**Spec:** `docs/superpowers/specs/2026-10-07-drink-collection-design.md`

## Global constraints

No new dependencies; all web data through the API; auth-only supabase-js;
Supabase CLI runs migrations; local test targets only; feature starts at main.

## Review focus

- Concurrent duplicate saves must preserve one stable saved row.
- A forged owner or foreign saved ID must never expose/change another collection.
- Curated/custom names must group identically and edits must recompute tried state.
- Failed requests must retain input and allow retry without false success.
- Log query prefill must never replace edit data or create a log on navigation.

## Task 1: Collection persistence and API

- [ ] Write `api/test/collection.e2e.mjs`: use two disposable local auth accounts,
  real requests, literal expected names/counts and finally cleanup. Assert empty
  GET is 200 (initially 404), then validation, isolation, concurrent PUT, passport,
  edit/delete recomputation, RLS and cascade checks against the spec.
- [ ] Run against local API and observe missing-route failure.
- [ ] Add `savedDrinks` and entries owner/name index in `api/src/db/schema.ts`.
  Use a generated SQL normalized-name column and unique owner/name constraint.
- [ ] `cd api && npm run db:generate`; create migration with `supabase migration new
  drink_collection`; copy generated SQL, inspect it, then `supabase db push --local`.
- [ ] Add `api/src/collection.controller.ts`, register in `app.module.ts`.
  GET saved uses a correlated EXISTS on own entries; PUT uses an atomic ON CONFLICT DO
  UPDATE that preserves the existing name and returns the same row; DELETE scopes by owner.
  Passport uses row_number partitioned by normalized name plus window count/min,
  keeps row 1 and orders by last logged date then normalized name.
- [ ] Run collection e2e, API tests/lint/build; run the real collection acceptance checks in CI using disposable Supabase.

## Task 2: Collection UI and logging integration

- [ ] Write failing `web/test/collection.test.tsx` covering pending save, retry,
  list empty/error/retry, search/filter, links, form retention, and prefill.
- [ ] Add `web/app/save-drink.tsx` used by entry cards and `web/app/collection/page.tsx`.
  Use query keys `["saved-drinks"]` and `["passport"]`, with useMutation for writes.
  Save button PUTs `{name}`; removal uses saved UUID; both invalidate saved-drinks.
- [ ] Add desktop nav and a compact mobile collection link in home timeline.
- [ ] Update log loader/form to accept a trimmed bounded `drink` query parameter
  only outside edit mode; key the form by edit ID/prefill to handle navigation.
- [ ] Run web component suite, lint, typecheck and production build.

## Task 3: End-to-end verification and shipping

- [ ] Run API regression e2e plus collection e2e using local DB/auth only.
- [ ] Exercise actual UI with disposable accounts at mobile and desktop widths;
  record real persistence, tried/passport updates, error recovery and overflow.
- [ ] Obtain independent review of spec and full diff; fix material findings.
- [ ] Commit and push feature, PR to dev, wait for both CI jobs, merge and verify
  dev diff. Prepare hosted migration dry-run before the ship skill approval gate.
- [ ] After reviewed hosted migration application, PR same feature to main,
  wait for CI, merge, verify remote state, report deployment limits honestly.

## Execution evidence

- Baseline: clean main at 934a0e8; branch feat/drink-collection from origin/main.
- Ruling: use existing clean checkout on a feature branch; no parallel implementers.
- Ruling: user explicitly delegated feature selection and implementation; complete
  written spec/plan first and proceed under that authorization without extra design gates.

- Review: one confirmed whitespace identity defect fixed by using PostgreSQL whitespace
  cleanup in saves and trimming legacy outer spaces in passport/tried lookups.
  Added regression cases for U+FEFF and boundary tabs.
- Ruling: CI runs real Auth/API/DB acceptance tests instead of mocked validation unit
  tests. This proves the constraints and scoping; cost is longer CI startup.
- Review evidence gaps closed: simultaneous first insert, saved timestamp preservation,
  exact UUID tie break, blank legacy names, and populated client-role RLS checks.
- Local checks: API suite 23 passing; web suite 25 passing; regression e2e 102 passing;
  collection e2e 73 passing; both lint/builds pass. Local security advisors: no issues.
- User direction: proceed end to end without further questions; permission policy
  now permits execution, so manual migration and release approval gates are authorized.
