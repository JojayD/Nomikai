import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuthGuard, UserId } from './auth.guard';
import { DB, type Db } from './db';
import { type EntryRow, withSignedUrls } from './entry-rows';
import { StorageService } from './storage.service';

const MAX_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

@Controller('feed')
@UseGuards(AuthGuard)
export class FeedController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  /**
   * Own entries, friend entries posted after acceptance, and exactly one
   * pre-acceptance entry per friend (their most recent). created_at, not
   * logged_at, decides pre/post: logged_at is user-editable backdating.
   *
   * This was the feed_entries() SQL function. It ran security invoker and
   * leaned on RLS both to scope `friendships` to the caller and to scope
   * `entries` to what they may see; the viewer id is now bound explicitly.
   */
  @Get()
  async list(
    @UserId() viewerId: string,
    @Query('before_logged_at') beforeLoggedAt = 'infinity',
    @Query('before_id') beforeId = MAX_ID,
    @Query('limit') limit = '30',
  ) {
    const lim = Math.min(Number(limit) || 30, 100);
    const result = await this.db.execute(sql`
      with friends as (
        select case when f.requester_id = ${viewerId} then f.addressee_id
                    else f.requester_id end as friend_id,
               f.accepted_at
        from friendships f
        where f.status = 'accepted'
          and ${viewerId} in (f.requester_id, f.addressee_id)
      ),
      visible as (
        select e.* from entries e where e.user_id = ${viewerId}
        union all
        select e.* from friends fr
          join entries e
            on e.user_id = fr.friend_id and e.created_at >= fr.accepted_at
        union all
        select le.* from friends fr
          cross join lateral (
            select e.* from entries e
            where e.user_id = fr.friend_id and e.created_at < fr.accepted_at
            -- logged_at has minute precision from the form, so ties are common;
            -- created_at breaks them with actual posting order
            order by e.logged_at desc, e.created_at desc, e.id desc
            limit 1
          ) le
      )
      select v.id, v.user_id, p.username, p.avatar_url,
             coalesce(d.name, v.custom_drink_name) as drink_name,
             v.night_out_id, n.name as night_out_name,
             v.location, v.photo_path, v.note, v.recommended, v.logged_at,
             (select count(*)::int from reactions r where r.entry_id = v.id) as reaction_count,
             exists (select 1 from reactions r where r.entry_id = v.id and r.user_id = ${viewerId}) as reacted_by_me
      from visible v
      join profiles p on p.id = v.user_id
      left join drinks d on d.id = v.drink_id
      left join night_outs n on n.id = v.night_out_id
      where (v.logged_at, v.id) < (${beforeLoggedAt}::timestamptz, ${beforeId}::uuid)
      order by v.logged_at desc, v.id desc
      limit ${lim}
    `);
    return withSignedUrls(this.storage, result as unknown as EntryRow[]);
  }
}
