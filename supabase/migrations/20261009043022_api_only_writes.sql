-- All application writes now go through the API. Legacy direct writes bypass
-- its block checks, validation, and photo-path ownership checks before signing.
revoke insert, update, delete on
  public.profiles, public.drinks, public.entries, public.night_outs, public.friendships,
  public.blocks, public.reactions, public.saved_drinks
  from anon, authenticated;

-- Table-level revocation does not remove previously granted column privileges.
revoke update (username, timezone, avatar_url, leaderboard_opt_in)
  on public.profiles from anon, authenticated;
revoke update (status) on public.friendships from anon, authenticated;
