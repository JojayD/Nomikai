# Sizing standard: desktop

Desktop is 1024px and up (`lg:`). Wide desktop is 1280px and up (`xl:`), which only adds the two-column layouts below.
Tokens, colours, radius and the type scale are shared with mobile; see [sizing.md](sizing.md). This file covers what differs on desktop.
The rules live in the `min-width: 1024px` and `min-width: 1280px` blocks of `web/app/globals.css`.

## Shell

| Part | 1024px and up | 1280px and up |
| --- | --- | --- |
| App shell | grid: nav rail + content, max 1600px | same |
| Nav rail (`.desktop-nav`) | 220px, sticky, full height, padding 36px 20px 24px, 40px between groups | 240px, side padding 24px |
| Nav link (`.feed-nav-link`) | min height 52px, padding 10px 12px, icon gap 14px, radius 8px | same |
| Wordmark (`.feed-brand`) | 26px, weight 800 | same |
| Mobile header (`.feed-mobile-header`) | hidden | hidden |

## Pages (`.desktop-page`)

Padding 28px 32px 48px, centred. Page header: 26px title (20px on mobile), 20px padding below, 16px margin below.

| Page | Max width |
| --- | --- |
| default (collection) | 960px |
| board, friends, recap | 800px |
| log, night | 760px |
| profile | 1120px |
| login, onboarding (`.auth-page`) | 520px card, 1px border, 32px side padding, 48px above and below |

## Feed

| Part | 1024px and up | 1280px and up |
| --- | --- | --- |
| Column (`.feed-timeline`) | max 584px, centred, padding 36px 32px | same |
| Title row (`.feed-title`) | shown, 24px margin below, 26px heading | same |
| Card | padding 24px, 14px gap, radius 16px, no side margin | same |
| Photo | 4:5 frame, max 472px, 16px above, 1px border | same |
| Author avatar | 32px circle, 10px gap to name | same |
| Meta line | 12px, not uppercase | same |
| Reaction button | 44px by 44px, 20px emoji | same |
| Profile rail (`.feed-profile`) | hidden | 280px, sticky, padding 44px 24px 24px 0 |

## Buttons

No extra tap target on desktop: `btn-md` is 42px and `btn-sm` is 36px, exactly as drawn.

| Where | Size |
| --- | --- |
| Primary action on a form | `btn-lg` (50px) |
| Feed title row | `btn-md` (42px, 13px text), set by `.feed-title .btn` |
| Inline and secondary actions | `btn-sm` (36px) |

Inputs stay 42px tall with 15px text.

## Columns

| Layout | 1024px and up | 1280px and up |
| --- | --- | --- |
| Collection (`.collection-grid`) | 2 columns, 32px column gap | same |
| Log details (`.log-details`) | 2 columns, 20px gap | same |
| Log flow | every step on one page, no sticky step buttons | same |
| Profile (`.profile-layout`) | one column | 320px overview and account panel + history, 24px gap |

## Camera

From 640px wide and 501px tall the camera is a dialog, not full screen: up to 480px by 800px, 24px from the window edges, radius 24px.
