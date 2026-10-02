import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuthGuard, UserId } from './auth.guard';
import { DB, type Db } from './db';
import { StorageService } from './storage.service';

type BoardRow = {
  id: string;
  username: string;
  avatar_url: string | null;
  unique_drinks: number;
  nights_out: number;
};

/**
 * F9: mutual friends only, ranked on unique drinks then nights out. Computed
 * on read — the member set is one circle of friends, so the aggregate is a
 * handful of rows and trivially idempotent for a window.
 * ponytail: on-read query, move to a scheduled snapshot if circles get big.
 *
 * Windows start Monday 4am in the viewer's timezone; each member's nights are
 * counted in their own timezone, consistent with profile stats. An opted-out
 * viewer sees only themselves; opted-out friends are excluded. Blocking
 * deletes the friendship, so blocked users drop out with no extra filter.
 */
@Controller('leaderboard')
@UseGuards(AuthGuard)
export class LeaderboardController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async list(@UserId() viewerId: string, @Query('window') window = 'week') {
    const unit = window === 'month' ? 'month' : 'week';
    const result = await this.db.execute(sql`
      with viewer as (
        select timezone, leaderboard_opt_in
        from profiles where id = ${viewerId}
      ),
      w as (
        select (date_trunc(${unit}, now() at time zone v.timezone - interval '4 hours')
                + interval '4 hours') at time zone v.timezone as start_at
        from viewer v
      ),
      members as (
        select p.id, p.username, p.avatar_url, p.timezone
        from profiles p
        where p.id = ${viewerId}
           or ((select leaderboard_opt_in from viewer)
               and p.leaderboard_opt_in
               and exists (
                 select 1 from friendships f
                 where f.status = 'accepted'
                   and ((f.requester_id = ${viewerId} and f.addressee_id = p.id)
                     or (f.addressee_id = ${viewerId} and f.requester_id = p.id))))
      )
      select m.id, m.username, m.avatar_url,
             count(distinct coalesce(e.drink_id::text, e.normalized_drink_name))::int as unique_drinks,
             count(distinct ((e.logged_at at time zone m.timezone - interval '4 hours')::date))::int as nights_out
      from members m
      left join entries e
        on e.user_id = m.id and e.logged_at >= (select start_at from w)
      group by m.id, m.username, m.avatar_url
      -- ties share their numbers; username keeps the order deterministic
      order by unique_drinks desc, nights_out desc, m.username asc
    `);
    const rows = result as unknown as BoardRow[];
    const signed = await this.storage.sign(rows.map((r) => r.avatar_url));
    return rows.map((r) => ({
      ...r,
      avatar_src: r.avatar_url ? (signed.get(r.avatar_url) ?? null) : null,
    }));
  }
}
