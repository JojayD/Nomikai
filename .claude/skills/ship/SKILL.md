---
name: ship
description: Use when the user asks for any code change in Nomikai, before creating a branch, committing, opening a PR, or merging — and whenever the user types /ship.
---

# Ship a change: main → feature branch → dev → Codex → user approval → main

Ship: $ARGUMENTS (if empty, ship the uncommitted changes / current feature branch).

The rule this flow exists for: **`dev` is never merged into `main`.** `dev` is the staging branch (Render redeploys it); the feature branch is what goes into `main`, which deploys production. The user personally approves every merge into `main`.

## Steps

1. **Branch off main**, never off dev, before the first edit:
   `git fetch origin && git checkout -b <fix|feat|chore>/<slug> origin/main --no-track`
   If already on a feature branch cut from main, keep it.

2. **Local checks** for whichever side changed (CI runs the same):
   - `web/`: `npm run lint`, `npx tsc --noEmit`, `npm test`
   - `api/`: `npm run lint`, `npm run test`

3. **PR into dev**: commit, push, `gh pr create --base dev` (not `--draft`; drafts can't be merged).
   `gh pr checks <n> --watch --fail-fast`, then `gh pr merge <n> --merge`. Keep the branch.

4. **Codex check** of the branch against main:
   ```bash
   node ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs review --wait --base origin/main
   ```
   Real finding → fix on the feature branch, push, repeat step 3 for the fix. Report what Codex said and what you did about it.

5. **STOP for the user's browser test.** Tell them staging has the change and what to click through. Do not open the main PR until they say go. If nothing visible changed, say so and still ask for the go-ahead.

6. **On approval, PR the same feature branch into main**: `gh pr create --base main`, CI green, `gh pr merge <n> --merge`.

7. **Wrap up**: report both PR URLs, what Codex found, what was tested, and anything that was not.

## Conflicts

The PR into dev conflicts when another branch merged into dev touched the same files.
- Fix is already on `main`: `git merge origin/main` into the feature branch, resolve, push.
- Fix is only on `dev` (its main PR not merged yet): merge *that feature branch* into yours, never `dev`.

## Stop and ask instead of continuing when

- A check or CI job fails and the fix is not obvious.
- The change needs a manual step: a Supabase migration (`supabase db push`), a new Render env var, or a Supabase dashboard setting.

## Don'ts

- No direct pushes to `dev` or `main`; everything goes through PRs.
- No "promote dev" PR (`dev` → `main`), and never `git merge dev` into a feature branch.
- No squash or rebase merges; the repo uses merge commits.
- No main PR before the user's explicit approval.
