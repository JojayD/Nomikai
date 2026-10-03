---
name: ship
description: Ship the current change through Nomikai's flow — branch off main, PR into dev to test, then PR the same branch into main and merge once confident. Use only when the user types /ship.
disable-model-invocation: true
---

# Ship a change: main → feature branch → dev (test) → main

Ship: $ARGUMENTS (if empty, ship the uncommitted changes / current feature branch).

The rule this flow exists for: **`dev` is never merged into `main`.** `dev` is a testing branch; the feature branch is what goes into `main`. `main` deploys to production on Render.

## Steps

1. **Local checks** for whichever side changed (CI runs the same):
   - `web/`: `npm run lint`, `npx tsc --noEmit`
   - `api/`: `npm run lint`, `npm run test`
   - UI change: run the app and exercise the changed screen in Codex in Chrome (the user's preference). Ask before a step with side effects, e.g. submitting the login form sends a real email.

2. **Branch off main**, never off dev:
   `git fetch origin && git checkout -b <fix|feat>/<slug> origin/main --no-track`
   (uncommitted changes carry over). Commit. If already on a feature branch that was cut from main, keep it.

3. **PR into dev**: push, `gh pr create --base dev`. When CI (`web`, `api`) is green, `gh pr merge <n> --merge`. Do not delete the branch.

4. **Test in dev**: `git fetch origin`. If `git diff origin/dev <branch>` is empty, the checks from step 1 already cover dev. Otherwise dev holds other work too — run the app from `origin/dev` and re-check the change there.

5. **PR the same feature branch into main**: `gh pr create --base main`. When CI is green and step 4 passed, `gh pr merge <n> --merge`.

6. **Wrap up**: `git checkout main && git pull`. Report both PR URLs, what was tested, and anything that was not.

## Stop and ask instead of merging into main when

- A check or CI job fails and the fix is not obvious (otherwise fix on the feature branch and push — both PRs pick it up).
- Something in the change could not be tested.
- The change needs a manual step: a Supabase migration (`supabase db push`), a new Render env var, or a Supabase dashboard setting.
- The PR into dev has merge conflicts. Do **not** merge `dev` into the feature branch to resolve them — that would carry `dev` into `main`. Say what conflicts and ask.

## Don'ts

- No direct pushes to `dev` or `main`; everything goes through PRs.
- No "promote dev" PR (`dev` → `main`).
- No squash or rebase merges; the repo uses merge commits.
