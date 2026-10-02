-- Stop clients from writing profiles.avatar_url directly.
--
-- The API signs whatever storage path this column holds using the secret key
-- (bypassing storage RLS) and returns it as avatar_src to any viewer. With the
-- update grant in place, a client could set its own avatar_url to another
-- user's photo path via PostgREST and get a signed URL for a friends-only
-- photo. Avatar uploads set this column server-side (the API connects as
-- postgres and ignores this grant), so nothing legitimate breaks.
revoke update (avatar_url) on public.profiles from authenticated;
