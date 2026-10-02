import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuthGuard, UserId } from './auth.guard';
import { DB, type Db } from './db';

/**
 * F8: the viewer's stats for the current week (since Monday 4am, own
 * timezone). Computed on read instead of a scheduled job: the numbers are a
 * pure function of the window, so recomputing is idempotent by construction
 * and there is no snapshot to get stale.
 * ponytail: no weekly cron; add one only if a push notification ever needs it.
 */
@Controller('recap')
@UseGuards(AuthGuard)
export class RecapController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async current(@UserId() userId: string) {
    const [stats] = (await this.db.execute(sql`
      with me as (select username, timezone from profiles where id = ${userId}),
      w as (
        select (date_trunc('week', now() at time zone m.timezone - interval '4 hours')
                + interval '4 hours') at time zone m.timezone as start_at
        from me m
      )
      select (select username from me) as username,
             (select timezone from me) as timezone,
             (select start_at from w) as week_start,
             count(*)::int as total_entries,
             count(distinct coalesce(e.drink_id::text, e.normalized_drink_name))::int as unique_drinks,
             count(distinct ((e.logged_at at time zone (select timezone from me) - interval '4 hours')::date))::int as nights_out
      from entries e
      where e.user_id = ${userId} and e.logged_at >= (select start_at from w)
    `)) as unknown as [
      {
        username: string | null;
        timezone: string | null;
        week_start: string | null;
        total_entries: number;
        unique_drinks: number;
        nights_out: number;
      },
    ];

    const [mostReacted] = (await this.db.execute(sql`
      with me as (select timezone from profiles where id = ${userId})
      select coalesce(d.name, e.custom_drink_name) as drink_name,
             count(*)::int as reactions
      from entries e
      join reactions r on r.entry_id = e.id
      left join drinks d on d.id = e.drink_id
      where e.user_id = ${userId}
        and e.logged_at >= (
          select (date_trunc('week', now() at time zone m.timezone - interval '4 hours')
                  + interval '4 hours') at time zone m.timezone
          from me m)
      group by e.id, coalesce(d.name, e.custom_drink_name)
      order by count(*) desc, max(r.created_at) desc
      limit 1
    `)) as unknown as [{ drink_name: string; reactions: number } | undefined];

    return { ...stats, most_reacted: mostReacted ?? null };
  }
}
