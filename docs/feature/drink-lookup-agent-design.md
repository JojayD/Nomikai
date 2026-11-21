# Bar menu agent: design

Status: built (all four build steps). Hosted needs the `bar_menus` migration and
`ANTHROPIC_API_KEY` on the Render API service; without the key every bar answers
`none` and no model call is made.

## Objective

When a member logs a drink at a bar, show them what that bar actually serves.
The member taps "Use my location", picks a nearby bar, and the log form lists
the drinks on that bar's menu as tappable chips. If we have never seen the bar's
menu, an agent searches the web for it, saves the drinks it finds against that
bar, and the chips appear a few seconds later.

What exists today:

- `GET /bars?q=` searches a static OSM snapshot (`api/src/bars/bars.json`,
  1,587 Bay Area bars) by name. The snapshot has no coordinates and no id.
- `entries.location` and `night_outs.location` are free text. Nothing in the
  app reads the device location or photo EXIF data.
- `drinks` is a curated list that changes only through migrations.

## How it works

1. **Find nearby bars.** The bar picker (`web/app/log/bar-picker.tsx`) gets a
   "Use my location" button. It calls `navigator.geolocation` and then
   `POST /bars/nearby` with `{ lat, lng }`, which returns the 10 nearest bars
   within 500 m. The coordinates go in the body so they stay out of URLs and
   access logs, are used for that one request, and are never stored.
   Typing a bar name keeps working as it does now.

2. **Ask for the menu.** Picking a bar calls `GET /bars/:type/:id/menu` (the id
   is the OSM one, such as `node/123456`):

   | Stored state | Response |
   | --- | --- |
   | Menu is `ready` | `{ status: "ready", items, sourceUrls }` |
   | Looked up before, nothing found | `{ status: "none" }` |
   | Lookup running | `{ status: "pending" }` |
   | Never looked up | Insert a `pending` row, start the lookup, return `{ status: "pending" }` |

   The primary key on `bar_menus.bar_id` means two members picking the same bar
   at once start only one lookup. The web app polls every 3 seconds inside one
   TanStack Query, for about a minute.

3. **Look up the menu.** One Claude call with Anthropic's server-side web search
   tool (capped searches) and one custom tool, `submit_menu`, which ends the
   call. The prompt contains the bar's name, city and address and nothing else.

   ```json
   {
     "has_menu": true,
     "items": [
       { "name": "Spicy Margarita", "is_alcoholic": true, "category": "cocktail" }
     ],
     "source_urls": ["https://..."]
   }
   ```

   `category` is one of `beer`, `wine`, `spirit`, `cocktail`, `shot`,
   `non_alcoholic`, `other`. Drinks only, no food. At most 60 items.

4. **Save it.** Our code inserts the items and marks the menu `ready`, or marks
   it `none` when `has_menu` is false. The agent has no database tool.

5. **Show it.** The log form shows "On the menu at <bar>" with the drinks as
   chips and a "from the web" link to the first source. Tapping a chip fills the
   drink field, exactly as if the member had typed it, so it is logged through
   the existing path (curated `drink_id` when the name matches, otherwise
   `custom_drink_name`). While pending it shows "Looking up menu…". On `none`
   the section is hidden and the form works as it does today.

6. **Refresh.** A menu older than 30 days is deleted on the next read and looked
   up again. A `pending` row older than 2 minutes is treated as failed and
   retried, which covers an API restart or a failed model call mid-lookup.

## Data model

Bars stay in the JSON snapshot. `api/scripts/fetch-bars.mjs` is changed to keep
three more fields per bar: `id` (OSM type and id, such as `node/123456`), `lat`
and `lon` (Overpass `out center` already returns a centre for ways).

Two new tables in `api/src/db/schema.ts`, with RLS enabled and no policies like
`saved_drinks`, so they are reachable only through the API.

```sql
create table bar_menus (
  bar_id text primary key,
  status text not null default 'pending',
  source_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  fetched_at timestamptz,
  constraint bar_menus_status_check
    check (status in ('pending', 'ready', 'none')),
  -- a ready menu must be cited
  constraint bar_menus_cited_check
    check (status <> 'ready' or cardinality(source_urls) >= 1)
);

create table bar_menu_items (
  id bigint generated always as identity primary key,
  bar_id text not null references bar_menus on delete cascade,
  name text not null,
  normalized_name text generated always as
    (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored not null,
  is_alcoholic boolean not null,
  category text not null,
  constraint bar_menu_items_bar_name_key unique (bar_id, normalized_name),
  constraint bar_menu_items_name_check
    check (char_length(name) between 1 and 120),
  constraint bar_menu_items_category_check
    check (category in ('beer','wine','spirit','cocktail','shot','non_alcoholic','other'))
);
```

Menu drinks are scoped to their bar and never enter `drinks`. The curated list
keeps its rule of changing only through migrations.

Following the project rule, Postgres constraints are the validation layer: a
malformed answer fails the insert and the menu is stored as `none`.

## Duplicates

Each bar owns its own set of drinks. Duplicates are checked per bar, never
across bars.

| Case | Rule |
| --- | --- |
| Same drink twice on one bar's menu | `unique (bar_id, normalized_name)`. The insert uses `on conflict do nothing`, so "Lychee Martini" and "lychee  martini" become one row. |
| Same bar looked up twice | `bar_menus.bar_id` is the primary key, so a second lookup never starts while one exists. |
| Same bar listed twice in the snapshot | `fetch-bars.mjs` already keeps one entry per name, city and address. |
| Refresh after 30 days | The old menu is deleted before the new one is saved, so a refresh replaces the set and never adds to it. |
| Same drink at different bars | Allowed. "Red Bull Vodka" at three bars is three rows, one per bar. They share a `normalized_name`, which is what a later "which bars serve this" feature would join on. |
| A menu drink that is also in `drinks` | Stays a menu row. Tapping its chip logs the curated drink because the names match. |

Not handled: different spellings of the same drink ("Vodka Red Bull" and
"Red Bull Vodka") are separate names. That only matters for the cross-bar
feature and is tracked there.

## Guardrails

| Risk | Control |
| --- | --- |
| Prompt injection from a scraped page | Page text is data. The only thing the agent can produce is a list of short drink names for one bar, checked by constraints and shown with its source link. It cannot reach `drinks` or member data. |
| Wrong or stale menu | Every menu shows where it came from, expires after 30 days, and only pre-fills a field the member can still edit. |
| Runaway cost | One lookup per bar per 30 days, capped searches and output tokens per lookup, `@Throttle` on the menu endpoint per member, and a daily cap on new lookups (over the cap, the endpoint returns `none` without calling the model). |
| Privacy | Only the bar's public name, city and address are sent to the model. Coordinates are never stored. No user ids, notes, photos or friend data leave the API. |
| Location permission denied | The button shows a short message and the name search still works. |
| Scraping terms | The model reads public pages through the search tool. Every menu keeps its source URLs. |

## Where the code goes

- `api/scripts/fetch-bars.mjs`: keep `id`, `lat`, `lon`. Regenerate `bars.json`.
- `api/src/bars/search.ts`: add `nearbyBars(lat, lng)`, a haversine scan over
  the in-memory snapshot. 1,587 rows needs no index.
- `api/src/bars/bars.controller.ts`: `POST /bars/nearby` and
  `GET /bars/:type/:id/menu`.
- `api/src/bars/menu-agent.ts`: the Claude call and `submit_menu` handling. The
  lookup is started in-process without awaiting it. A queue is not needed at
  this size.
- `web/app/log/bar-picker.tsx`: the location button and the menu chips.
  `web/lib/api.ts`: the two calls.
- One new dependency, `@anthropic-ai/sdk`. Start with `claude-haiku-5-5` and
  move to `claude-sonnet-5-5` only if menus come back poor.
- `ANTHROPIC_API_KEY` goes in `api/.env` and in the Render API service.

## Build order

1. **Dry run.** A throwaway script that runs the lookup on 5 real bars and
   prints the result. No schema change. Verify by eye: are the drinks real and
   from that bar, and how many bars have a menu online at all? Stop here if the
   hit rate is poor.
2. **Nearby bars.** Snapshot fields, `nearbyBars`, the location button.
   Verify: the button lists bars around a known coordinate.
3. **Menu tables and endpoint.** Schema, migration, `GET /bars/:id/menu`, the
   agent. Verify: first call returns `pending`, a later call returns `ready`,
   and a second lookup for the same bar never starts.
4. **Chips in the log form.** Verify: pick a bar, tap a chip, the entry saves
   with that drink.

## Tests

- `nearbyBars`: unit test next to `search.spec.ts` (ordering and the 500 m cut).
- `submit_menu` handling: canned model replies for a menu, no menu, a malformed
  answer and more than 60 items. No network or API cost.
- The constraints (uncited `ready` menu, duplicate drink per bar) were checked
  by hand against the local database.
- Not built: a `test:e2e` case with the model call stubbed. The endpoint was
  checked by hand against the local stack with a real lookup.

## Not in this version

- **Location from photos.** Browsers usually strip GPS data from camera
  captures, so the location button is the reliable route.
- **Bars outside the Bay Area.** The snapshot's bounding box is unchanged.
- **Prices and descriptions.** Names and categories only.
- **Promoting drinks into `drinks`.** The earlier idea of researching custom
  drink names that members log repeatedly is dropped from this spec. It could
  come back later and reuse the same agent code.

## Decisions for the owner

1. **Scope note.** `20260825003100_drinks.sql` records a "no scraped source"
   rule for `drinks`. Menu items stay out of `drinks`, so the rule holds for the
   curated list, but the app would now show web-sourced drink names. Confirm
   that is intended.
2. **No human review.** Menus go live as soon as they are found, labelled with
   their source. The alternative is a review step, which would make the feature
   useless at the moment someone is standing in the bar.
3. **Daily cap.** How many new bar lookups per day to allow. Built as 20 in
   total and 5 started by one member (`DAILY_LOOKUPS` and `DAILY_LOOKUPS_EACH`
   in `bars.controller.ts`; `bar_menus.requested_by` records who started one).
