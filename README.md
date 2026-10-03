# Nomikai

A drink-counting app with leaderboards and different drinks to try. (Nomikai is Japanese for a drinking party.)

## Structure

- `web/` — Next.js frontend
- `api/` — NestJS backend (Drizzle ORM)
- `supabase/` — Supabase config and migrations

## Development

Branch flow:

1. Create a feature branch off `main` (`feat/<name>`)
2. Merge the feature branch into `dev` for testing (staging)
3. When testing is done, merge the same feature branch into `main`

CI runs lint, tests, and builds on every PR.

## Email sign-in (6-digit OTP)

Users request an email code and enter it in the same tab. Supabase verifies the
code and creates the session; both new and returning users use this flow.
Password sign-in is also available, with code verification for new accounts.

Local Supabase uses `supabase/templates/otp.html` for both sign-in and signup
emails. Restart the local stack after changing `supabase/config.toml`.

For the hosted project, configure these settings in the Supabase dashboard
before deploying the OTP frontend (local config changes do not update hosting):

1. **Authentication → Email → Templates**: update both **Magic Link** (returning
   users) and **Confirm signup** (new users). Set the subject to
   `Your Nomikai code` and copy the HTML from `supabase/templates/otp.html`.
   The body must contain `{{ .Token }}` instead of a sign-in link using
   `{{ .ConfirmationURL }}` or `{{ .TokenHash }}`.
2. **Authentication → Sign In / Providers → Email**: set **Email OTP length** to
   **6** and **Email OTP expiration** to **3600 seconds**. Keep email
   confirmations enabled for new accounts.
3. If Supabase blocks custom templates with its default email provider, configure
   **custom SMTP** first. The repo includes disabled Resend SMTP settings;
   use a verified sender domain for delivery to users (the `onboarding@resend.dev`
   test sender only delivers to the Resend account owner).

Do not push the entire local config to update hosted templates: it also contains
local redirect URLs and disabled SMTP settings. Change the hosted auth settings
above directly. The existing `/auth/confirm` route still handles previously
issued links.

Before rollout, test a new account and an existing account: each email should
contain six digits, a valid code should sign in in the original tab, an invalid
or expired code should leave the code form visible with an error, and resend
should allow retrying after Supabase's cooldown.
