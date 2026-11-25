import { eq, sql } from 'drizzle-orm';
import type { Db } from './db';
import { drinks, entries, nightOuts, profiles } from './db/schema';
import type { StorageService } from './storage.service';

/**
 * The columns feed_entries() used to return, kept in snake_case because the
 * web app renders these rows directly.
 */
export const entryColumns = {
  id: entries.id,
  user_id: entries.userId,
  username: profiles.username,
  avatar_url: profiles.avatarUrl,
  drink_name: sql<string>`coalesce(${drinks.name}, ${entries.customDrinkName})`,
  night_out_id: entries.nightOutId,
  night_out_name: nightOuts.name,
  location: entries.location,
  photo_path: entries.photoPath,
  note: entries.note,
  rating: entries.rating,
  logged_at: entries.loggedAt,
};

export type EntryRow = {
  [K in keyof typeof entryColumns]: K extends
    'id' | 'user_id' | 'username' | 'drink_name' | 'logged_at'
    ? string
    : K extends 'rating'
      ? number | null
      : string | null;
} & { reaction_count: number; reacted_by_me: boolean; comment_count: number };

/** F6: the toggle count and the viewer's own state ride on every entry row. */
export function reactionColumns(viewerId: string) {
  return {
    reaction_count: sql<number>`(select count(*)::int from reactions r where r.entry_id = ${entries.id})`,
    reacted_by_me: sql<boolean>`exists (select 1 from reactions r where r.entry_id = ${entries.id} and r.user_id = ${viewerId})`,
    // ponytail: counts comments a block hides from this viewer; filter here if it ever confuses anyone
    comment_count: sql<number>`(select count(*)::int from comments c where c.entry_id = ${entries.id})`,
  };
}

export function entryQuery(db: Db, viewerId: string) {
  return db
    .select({ ...entryColumns, ...reactionColumns(viewerId) })
    .from(entries)
    .innerJoin(profiles, eq(profiles.id, entries.userId))
    .leftJoin(drinks, eq(drinks.id, entries.drinkId))
    .leftJoin(nightOuts, eq(nightOuts.id, entries.nightOutId));
}

/**
 * The photos bucket is private, so rows carry short-lived signed URLs. Callers
 * must already have filtered the rows to what the viewer may see.
 */
export async function withSignedUrls<
  T extends { photo_path: string | null; avatar_url: string | null },
>(storage: StorageService, rows: T[]) {
  const signed = await storage.sign([
    ...rows.map((r) => r.photo_path),
    ...rows.map((r) => r.avatar_url),
  ]);
  return rows.map((r) => ({
    ...r,
    photo_url: r.photo_path ? (signed.get(r.photo_path) ?? null) : null,
    avatar_src: r.avatar_url ? (signed.get(r.avatar_url) ?? null) : null,
  }));
}
