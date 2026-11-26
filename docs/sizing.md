# Sizing standard

Tokens live in `web/app/globals.css` (`@theme static`). Mobile is under 1024px, desktop is 1024px and up.
Use the token or class; do not write one-off pixel values or colours in components.
Desktop layout (rail, page widths, columns) is in [sizing-desktop.md](sizing-desktop.md).

## Buttons

Slightly rounded (6px). Plain `.btn` is `btn-lg`.

| Class | Min height | Padding | Font | Mobile | Desktop |
| --- | --- | --- | --- | --- | --- |
| `btn-lg` / `.btn` | 50px | 8px 14px | 15px | default | default |
| `btn-md` | 42px | 6px 14px | 13px | looks 42px, tap target 44px (invisible `::after`) | default inside `.feed-title` |
| `btn-sm` | 36px | 4px 12px | 13px | looks 36px, tap target 44px (invisible `::after`) | 36px |

`btn-ghost` is a text link with no min height and a rounded (8px) hover tint; do not combine it with the size classes.

`btn-md` and `btn-sm` set 13px text. Buttons that were 42px or 36px tall before this standard had 15px text.

## Type scale

Same on mobile and desktop. Classes set font size only.

| Token | Class | Size | Used for |
| --- | --- | --- | --- |
| `--text-10` | `text-10` | 10px | `.kicker` labels, smallest avatar initial |
| `--text-12` | `text-12` | 12px | field labels, fine print |
| `--text-13` | `text-13` | 13px | meta lines, helper text, md/sm buttons |
| `--text-15` | `text-15` | 15px | body, notes, lg buttons |
| `--text-20` | `text-20` | 20px | drink name, header wordmark |
| `--text-26` | `text-26` | 26px | page titles, stat numbers |
| `--text-32` | `text-32` | 32px | empty and success headings |
| `--text-44` | `text-44` | 44px | login wordmark |

Not on the scale: the camera screen. Tailwind's `text-xs` is still used in places; it is 12px, the same as `text-12`.

## Radius

| Token | Value | Used for |
| --- | --- | --- |
| `--radius-sm` | 6px | buttons, inputs, photos, avatars, bordered boxes |
| `--radius-md` | 8px | desktop nav links, hover tints (`btn-ghost`, dropdown rows) |
| `--radius-lg` | 16px | feed cards |
| `--radius-full` | 50% | avatars (desktop feed and rail) |

The camera screen keeps its own literal radii (50%, 24px, 28px).

## Posts (`.entry-card`)

| Part | Mobile | Desktop |
| --- | --- | --- |
| Photo | 4:5 frame, cover, max 472px wide, centred | 4:5 frame, cover, max 472px wide, centred |
| Note | 3 lines, tap to expand | 3 lines, tap to expand |
| No note or location | post is shorter | post is shorter |
| Card padding (feed) | 16px | 24px |

## Breakpoints and spacing

Spacing uses Tailwind's 4px scale. One breakpoint at 1024px (`lg:`); at 1280px the feed adds a profile rail and the nav rail widens.

| | Mobile (under 1024px) | Desktop (1024px and up) |
| --- | --- | --- |
| Shell | one column, max 430px | nav rail 220px (240px from 1280px) + content |
| Page padding | 16px sides (20px on login and onboarding) | 28px 32px 48px; page max 960px (800px board, friends, recap; 760px log, night; 1120px profile) |
| Feed column | full width | max 584px, padding 36px 32px |
| Feed card gap | 14px | 14px |

## Colours

Every colour is a token; dark values are set under `prefers-color-scheme: dark`.

| Token | Classes | Light | Dark |
| --- | --- | --- | --- |
| `--color-bg` | `bg-bg` | #f3f2f2 | #171514 |
| `--color-surface` | `bg-surface` | #eae9e9 | #231f1e |
| `--color-text` | `text-text`, `bg-text/5` | #201e1d | #f3f2f2 |
| `--color-accent` | `text-accent`, `border-accent` | #ec3013 | #ff563c |
| `--color-accent-600` / `-700` | button hover / active | #dd2b0f / #ae1800 | same |
| `--color-divider` | `border-divider`, `bg-divider` | text 40% | text 34% |
| `--color-card` | `bg-card` | #fff | #2b2725 |
| `--color-feed` | `bg-feed` | #e7e5e4 | #141211 |

Exempt: the camera screen (always dark, its own `--camera-*` variables) and `web/app/recap/image/route.tsx` (renders an image, cannot read CSS variables).
