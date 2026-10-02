import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  type AnyPgColumn,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUsers, authenticatedRole } from 'drizzle-orm/supabase';

// Row-level security is declared here so drizzle-kit keeps it, but it is no
// longer the access control that matters: the API connects as `postgres` and
// bypasses RLS entirely. Authorization lives in the guards and queries under
// src/. These policies are the backstop for anything hitting PostgREST with
// the publishable key directly.
const uid = sql`(select auth.uid())`;

export const profiles = pgTable(
  'profiles',
  {
    id: uuid().primaryKey().notNull(),
    userCode: text('user_code')
      .default(
        sql`substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 10)`,
      )
      .notNull(),
    username: text().notNull(),
    timezone: text().notNull(),
    ageAttestedAt: timestamp('age_attested_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    leaderboardOptIn: boolean('leaderboard_opt_in').default(true).notNull(),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.id],
      // drizzle-orm/supabase ships import-mode type references, so under
      // nodenext CJS this column is nominally (not structurally) distinct.
      // The runtime object is the right one; drizzle-kit needs the import so
      // it treats auth.users as external instead of generating it.
      foreignColumns: [authUsers.id as unknown as AnyPgColumn],
      name: 'profiles_id_fkey',
    }).onDelete('cascade'),
    unique('profiles_user_code_key').on(t.userCode),
    unique('profiles_username_key').on(t.username),
    check('profiles_username_check', sql`username ~ '^[a-z0-9_]{3,20}$'::text`),
    pgPolicy('authenticated read profiles', {
      for: 'select',
      to: authenticatedRole,
      using: sql`true`,
    }),
    pgPolicy('insert own profile', {
      for: 'insert',
      withCheck: sql`${uid} = id`,
    }),
    pgPolicy('update own profile', {
      for: 'update',
      using: sql`${uid} = id`,
    }),
  ],
).enableRLS();

export const drinks = pgTable(
  'drinks',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity({
      name: 'drinks_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: '9223372036854775807',
      cache: 1,
    }),
    name: text().notNull(),
    normalizedName: text('normalized_name').notNull(),
    isAlcoholic: boolean('is_alcoholic').notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique('drinks_normalized_name_key').on(t.normalizedName),
    pgPolicy('authenticated read drinks', {
      for: 'select',
      to: authenticatedRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

export const nightOuts = pgTable(
  'night_outs',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    name: text().notNull(),
    location: text(),
    startedAt: timestamp('started_at', {
      withTimezone: true,
      mode: 'string',
    })
      .defaultNow()
      .notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('night_outs_user_started_idx').using(
      'btree',
      t.userId.asc().nullsLast().op('timestamptz_ops'),
      t.startedAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [t.userId],
      foreignColumns: [profiles.id],
      name: 'night_outs_user_id_fkey',
    }).onDelete('cascade'),
    // target of the composite FK from entries
    unique('night_outs_id_user_id_key').on(t.id, t.userId),
    check(
      'night_outs_name_check',
      sql`(char_length(name) >= 1) AND (char_length(name) <= 80)`,
    ),
    pgPolicy('own or friends night outs select', {
      for: 'select',
      using: sql`${uid} = user_id OR public.is_friends_with(user_id)`,
    }),
    pgPolicy('own night outs insert', {
      for: 'insert',
      withCheck: sql`${uid} = user_id`,
    }),
    pgPolicy('own night outs update', {
      for: 'update',
      using: sql`${uid} = user_id`,
    }),
    pgPolicy('own night outs delete', {
      for: 'delete',
      using: sql`${uid} = user_id`,
    }),
  ],
).enableRLS();

export const entries = pgTable(
  'entries',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    drinkId: bigint('drink_id', { mode: 'number' }),
    customDrinkName: text('custom_drink_name'),
    // written by the entries_normalized_drink_name trigger; never sent by clients
    normalizedDrinkName: text('normalized_drink_name').notNull(),
    location: text(),
    photoPath: text('photo_path'),
    note: text(),
    recommended: boolean(),
    loggedAt: timestamp('logged_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    nightOutId: uuid('night_out_id'),
  },
  (t) => [
    index('entries_user_logged_idx').using(
      'btree',
      t.userId.asc().nullsLast().op('timestamptz_ops'),
      t.loggedAt.desc().nullsFirst().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [t.drinkId],
      foreignColumns: [drinks.id],
      name: 'entries_drink_id_fkey',
    }),
    foreignKey({
      columns: [t.userId],
      foreignColumns: [profiles.id],
      name: 'entries_user_id_fkey',
    }).onDelete('cascade'),
    // an entry can only point at its own user's night out
    foreignKey({
      columns: [t.nightOutId, t.userId],
      foreignColumns: [nightOuts.id, nightOuts.userId],
      name: 'entries_night_out_fk',
    }).onDelete('set null'),
    check(
      'entries_check',
      sql`(drink_id IS NULL) <> (custom_drink_name IS NULL)`,
    ),
    check('entries_note_check', sql`char_length(note) <= 140`),
    pgPolicy('own or friends entries select', {
      for: 'select',
      using: sql`${uid} = user_id OR public.is_friends_with(user_id)`,
    }),
    pgPolicy('own entries insert', {
      for: 'insert',
      withCheck: sql`${uid} = user_id`,
    }),
    pgPolicy('own entries update', {
      for: 'update',
      using: sql`${uid} = user_id`,
    }),
    pgPolicy('own entries delete', {
      for: 'delete',
      using: sql`${uid} = user_id`,
    }),
  ],
).enableRLS();

// F6: one reaction type, one row per (entry, user); the PK is the toggle.
export const reactions = pgTable(
  'reactions',
  {
    entryId: uuid('entry_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.userId], name: 'reactions_pkey' }),
    foreignKey({
      columns: [t.entryId],
      foreignColumns: [entries.id],
      name: 'reactions_entry_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.userId],
      foreignColumns: [profiles.id],
      name: 'reactions_user_id_fkey',
    }).onDelete('cascade'),
    // visible wherever the entry is visible
    pgPolicy('reactions on visible entries select', {
      for: 'select',
      using: sql`exists (select 1 from public.entries e where e.id = entry_id
        and (${uid} = e.user_id or public.is_friends_with(e.user_id)))`,
    }),
    pgPolicy('own reactions insert', {
      for: 'insert',
      withCheck: sql`${uid} = user_id and exists (
        select 1 from public.entries e where e.id = entry_id
        and (${uid} = e.user_id or public.is_friends_with(e.user_id)))`,
    }),
    pgPolicy('own reactions delete', {
      for: 'delete',
      using: sql`${uid} = user_id`,
    }),
  ],
).enableRLS();

// F10: blocking hides content both ways. The API deletes the friendship row in
// the same transaction, so feed/leaderboard/profile visibility (all friendship
// -gated) drops out without extra filters; this table's job is to stop the
// pair from re-friending.
export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id').notNull(),
    blockedId: uuid('blocked_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId], name: 'blocks_pkey' }),
    foreignKey({
      columns: [t.blockerId],
      foreignColumns: [profiles.id],
      name: 'blocks_blocker_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.blockedId],
      foreignColumns: [profiles.id],
      name: 'blocks_blocked_id_fkey',
    }).onDelete('cascade'),
    check('blocks_check', sql`blocker_id <> blocked_id`),
    pgPolicy('own blocks select', {
      for: 'select',
      using: sql`${uid} = blocker_id`,
    }),
    pgPolicy('own blocks insert', {
      for: 'insert',
      withCheck: sql`${uid} = blocker_id`,
    }),
    pgPolicy('own blocks delete', {
      for: 'delete',
      using: sql`${uid} = blocker_id`,
    }),
  ],
).enableRLS();

export const friendships = pgTable(
  'friendships',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    requesterId: uuid('requester_id').notNull(),
    addresseeId: uuid('addressee_id').notNull(),
    status: text().default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .defaultNow()
      .notNull(),
    // stamped by the friendships_accept trigger
    acceptedAt: timestamp('accepted_at', {
      withTimezone: true,
      mode: 'string',
    }),
  },
  (t) => [
    // one row per pair in either direction
    uniqueIndex('friendships_pair_idx').using(
      'btree',
      sql`LEAST(requester_id, addressee_id)`,
      sql`GREATEST(requester_id, addressee_id)`,
    ),
    foreignKey({
      columns: [t.requesterId],
      foreignColumns: [profiles.id],
      name: 'friendships_requester_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.addresseeId],
      foreignColumns: [profiles.id],
      name: 'friendships_addressee_id_fkey',
    }).onDelete('cascade'),
    check('friendships_check', sql`requester_id <> addressee_id`),
    check(
      'friendships_status_check',
      sql`status = ANY (ARRAY['pending'::text, 'accepted'::text])`,
    ),
    pgPolicy('participants read', {
      for: 'select',
      using: sql`${uid} IN (requester_id, addressee_id)`,
    }),
    pgPolicy('requester sends', {
      for: 'insert',
      withCheck: sql`${uid} = requester_id AND status = 'pending' AND accepted_at IS NULL`,
    }),
    // only pending -> accepted, only by the addressee
    pgPolicy('addressee accepts', {
      for: 'update',
      using: sql`${uid} = addressee_id AND status = 'pending'`,
      withCheck: sql`${uid} = addressee_id AND status = 'accepted'`,
    }),
    // decline, cancel, and unfriend are all this delete
    pgPolicy('participants delete', {
      for: 'delete',
      using: sql`${uid} IN (requester_id, addressee_id)`,
    }),
  ],
).enableRLS();
