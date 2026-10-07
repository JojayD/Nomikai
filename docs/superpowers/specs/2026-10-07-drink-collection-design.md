# Drink collection: engagement specification

## Objective and selection

Give members a reason to return to discover drinks and remember their tastes.
The user delegated selection of two features, implementation, end-to-end tests,
edge-case review, and shipping after CI. Engagement impact is a hypothesis;
shipping tests prove behavior, not a retention lift.

| Candidate | Return loop | Decision |
| --- | --- | --- |
| Want to try | Save an interesting drink, revisit the list, log it | Build |
| Drink passport | Rediscover unique drinks and personal recommendations | Build |
| Entry comments | Return to conversations with friends | Defer: moderation and visibility complexity |
| Shared night-out plans | Coordinate an upcoming outing | Defer: invitations and scheduling |
| Activity inbox | Catch up on friend interactions | Defer: unread state and notification infrastructure |

Selected approach: a private collection screen at `/collection` with Want to try
and Passport views. Reuse entries, name normalization, the existing log form,
and TanStack Query. A social-comments approach adds more moderation scope;
a notifications-first approach has no new activity worth returning to yet.

## Want to try

- Members save a drink by name from any visible entry card or by typing a name
  in their collection. Names are trimmed, internal whitespace collapsed, and
  limited to 120 Unicode characters; empty/non-string inputs return 400.
- Identity uses PostgreSQL lowercase and whitespace rules, with outer spaces
  trimmed after whitespace collapse. Legacy entries ignore leftover outer spaces. Case/spacing variants and concurrent PUT retries create
  one saved row per member. Existing display name and saved time are preserved.
- `PUT /collection/saved` takes `{name}` and returns the saved row.
  `GET /collection/saved` returns `{id,name,normalized_name,created_at,tried}[]`,
  newest saved first, UUID as tie breaker. `DELETE /collection/saved/:id` is
  owner-scoped and idempotently returns `{deleted:true}` even for a missing row.
- No user ID supplied by the client can select another member's collection.
  JWT is required on every route. Saved rows cascade when their owner is deleted.
- Saves retain only a name, no friend's entry, photo, author, or location.
  Unfriending/blocking or deleting the source post does not erase that private name.
- `tried` is derived from the member's current entries by normalized name.
  Logging does not destroy the save. Deleting/editing logs updates tried status.
- Saved rows link to `/log?drink=<encoded name>`. Prefill selects a custom name;
  existing entry edit mode always wins over the query parameter. Merely opening
  that link never creates a log. Normal submit/retry behavior remains intact.
- Entry-card save feedback is mutation state, with pending taps disabled and
  visible retryable errors. It is an idempotent save action, not an unsave toggle.

## Drink passport

- `GET /collection/passport` returns the signed-in member's unique drinks as
  `{normalized_name,name,first_logged_at,last_logged_at,times_logged,recommended}[]`.
- Group curated and custom drinks together when normalized names match. Ignore
  historical blank normalized names. Name and recommendation come from the
  latest log, ordered by logged_at, created_at, then UUID; null recommendation
  remains neutral. Dates/counts derive from all surviving logs in that group.
- Display unique-drink total, name search, All/Recommended filters, log count,
  first/last dates, and a Log again link for every row. Empty, no-match, loading,
  and retryable error states are distinct. Both alcoholic and nonalcoholic drinks
  are included without daily streaks or consumption targets.
- Passport is private and computed on read. No awards, jobs, notifications,
  public profile changes, or duplicate stored counters.

## Architecture and constraints

- New `saved_drinks` table: UUID PK, owner FK with cascade, name, generated
  normalized name, created_at, unique(owner,normalized name), name check.
  RLS enabled, no client-role policies: this table is API-only. API predicates
  remain mandatory because the API runs as postgres. Index entries by owner
  and normalized name for collection lookups.
- One Nest controller owns the three saved routes and passport read. Use
  parameterized Drizzle SQL and existing AuthGuard/PgErrorFilter.
- All web data access goes through the API and TanStack Query. Invalidate saved
  data after mutations; existing entry mutations already invalidate all queries.
- Keep installed dependencies. Match existing typography/buttons; accessible
  form labels, pressed filter state, live errors, wrapped long names, and mobile
  access to the collection without overcrowding the existing header.
- Lists load in full for the current small personal app, like drink history.
  Add server pagination if individual collections become large; mark this ceiling.
- Generate SQL with Drizzle, copy into a Supabase CLI-created migration, apply
  with Supabase CLI only. Local testing uses explicit loopback DB/auth URLs;
  existing checked-out env files point at hosted Supabase and must not drive tests.

## Acceptance and release gates

1. Real local API/Auth/Postgres test with throwaway members covers auth, private
   isolation, duplicate/concurrent saves, validation boundaries, own deletion,
   foreign deletion, normalized curated/custom grouping, deterministic latest
   recommendation, log edits/deletion, tried status, and account cascade.
2. Direct SQL checks prove RLS enabled and client roles cannot access saved rows.
3. Component tests cover save pending/error/retry, collection empty/search/filter,
   logging prefill and edit precedence; existing web/API suites remain green.
4. Browser exercise at mobile and desktop widths: save from feed, revisit after
   reload, log saved name, verify tried/passport, remove save, exercise filters.
5. Web/API lint, unit tests, production builds, full API regression e2e pass.
6. Independent review; feature branch from main → PR dev → green CI and test →
   same feature PR main → green CI. Follow ship skill's manual migration gate:
   prepare concrete migration evidence before hosted application. The user explicitly
   authorized end-to-end execution without additional approval checkpoints.
   Never merge dev into the feature branch or main.
