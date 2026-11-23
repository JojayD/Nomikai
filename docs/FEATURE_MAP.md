# Nomikai feature map

Last updated 2026-11-22. What exists, and what to build next.

Rules for anything new: keep it a fun side project. Compute on read before
adding a cron, reuse an existing table before adding one, and add a dependency
only when a few lines can't do it.

## Shipped

| Area | What it does | Where |
| --- | --- | --- |
| Auth | Email OTP and password sign-in, onboarding with age check | `web/app/login`, `web/app/onboarding` |
| Log a drink | Catalog search, custom names, photo (camera or file), note, "recommend" | `web/app/log`, `POST /entries` |
| Drink catalog | Curated drinks, spirits and branded shots | `drinks` table, migrations |
| Bars | OSM bar search, nearby bars by location, menu chips from the menu agent | `api/src/bars`, `bar_menus` |
| Night outs | Group a night's drinks under a named night | `web/app/nights/[id]`, `night_outs` |
| Friends | Invite links, requests, unfriend, block | `web/app/friends`, `web/app/add/[code]` |
| Feed | Friends' drinks with reactions | `web/app/feed.tsx`, `GET /feed` |
| Profile | Stats, history search, avatar | `web/app/u/[username]` |
| Collection | Want to try, drink passport, friend picks | `web/app/collection` |
| Leaderboard | Weekly board for friends, with opt-out | `web/app/board` |
| Recap | Weekly recap with a shareable image | `web/app/recap` |

## New features

Size: **S** is an evening, **M** is a weekend, **L** needs a plan doc first.

### Quick wins

**1. Drink ratings (S)**
Swap or extend the `recommended` boolean with a 1–5 rating on `entries`.
Show the average on drink pages and "top rated by friends" in the collection.
Touches: one migration, the log form, `entry-rows.ts`.

**2. Achievements (S)**
Badges computed on read from `entries`: first drink, 10 new drinks, 5 bars,
a drink every week for a month, tried a friend pick. Shown on the profile.
No table: same pattern as the leaderboard. Add a table only if we ever notify.

**3. Monthly drink bingo (S)**
A 4×4 card of catalog drinks picked by a seed of `user_id + month`, so no
storage. Logging a drink on the card marks it. Fills the "different drinks to
try" half of the app's pitch.

**4. Pace and water on night outs (S)**
The night page shows drinks per hour and nudges a water after every few
alcoholic ones. `drinks.is_alcoholic` already exists, so logging a water is
just logging a non-alcoholic drink. Client-side only.

**5. Year in review (S)**
The recap with a year window: top drink, top bar, busiest night, new drinks
tried. Reuses `recap.controller.ts` and the `next/og` image route. Ship in
December.

**6. Photo grid on profiles (S)**
A grid of the member's drink photos on `/u/[username]`, using the signed URLs
`StorageService` already returns.

### Medium

**7. Shared night outs (M)**
Friends join one night: combined tally, everyone's drinks in one timeline.
Needs a `night_out_members` table and a visibility check in `visibility.ts`
(members see each other's entries for that night even if they aren't friends).

**8. Comments on entries (M)**
Short comments under feed posts. New `comments` table; visibility follows the
entry, blocks hide both ways. Rate-limit like friend requests.

**9. Head-to-head (M)**
Pick a friend and compare: total drinks, new drinks, bars, overlap in drinks
tried. Computed on read from `entries` for the two members.

**10. Bar passport (M)**
Bars you've logged at, with counts and first visit. Needs entries to store the
OSM bar id next to the free-text `location` (the picker already knows it).
A map view would need a new dependency (Leaflet); start with a list.

**11. Installable app (M)**
A web app manifest and icons so the site installs to the home screen.
Next.js supports `app/manifest.ts` with no new dependency. Offline logging is
a separate, larger job.

### Bigger bets

**12. Notifications (L)**
Web push for friend requests, reactions, comments, and "your friend started a
night out". Needs a service worker, a `push_subscriptions` table, VAPID keys
on Render, and the installable app (11) for iOS. This is the point where the
leaderboard and recap would move from compute-on-read to a cron.

**13. Happy hours from the menu agent (L)**
Extend the bar menu agent to pull happy hour times and prices. Costs model
calls per bar and goes stale, so it needs a refresh policy before it's built.

## Not doing

- **BAC or "safe to drive" estimates.** Easy to get wrong, and a wrong number
  is a liability. Pace and water (4) is as far as the app goes.
- **Public profiles or global leaderboards.** Everything is friend-gated and
  should stay that way.
- **Report queue.** Same call as F10: nobody reads it, so block covers it.

## Suggested order

1. Ratings (1) and achievements (2): small, visible, no new tables beyond a column.
2. Bingo (3) and pace/water (4): make nights out more fun.
3. Year in review (5) before December ends.
4. Shared night outs (7): the biggest step up for the "party" in Nomikai.
5. Installable app (11), then notifications (12).
