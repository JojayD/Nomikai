import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AuthGuard, UserId } from './auth.guard';
import { DB, type Db } from './db';
import { savedDrinks } from './db/schema';

const savedColumns = {
  id: savedDrinks.id,
  name: savedDrinks.name,
  normalized_name: savedDrinks.normalizedName,
  created_at: savedDrinks.createdAt,
};

@Controller('collection')
@UseGuards(AuthGuard)
export class CollectionController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('saved')
  list(@UserId() userId: string) {
    // ponytail: full private list, paginate if individual collections grow large.
    return this.db
      .select({
        ...savedColumns,
        tried: sql<boolean>`exists(select 1 from entries e where e.user_id = ${userId}
        and btrim(e.normalized_drink_name) = ${savedDrinks.normalizedName})`,
      })
      .from(savedDrinks)
      .where(eq(savedDrinks.userId, userId))
      .orderBy(desc(savedDrinks.createdAt), desc(savedDrinks.id));
  }

  @Put('saved')
  async save(
    @UserId() userId: string,
    @Body() body: { name?: unknown } | null,
  ) {
    if (typeof body?.name !== 'string')
      throw new BadRequestException('Enter a drink name.');
    if (!body.name.trim() || body.name.includes('\0')) {
      throw new BadRequestException(
        'Use a drink name between 1 and 120 characters.',
      );
    }
    // Use the same Postgres whitespace rules as entries (JS \s also removes
    // U+FEFF). Outer whitespace left by older entry normalization is ignored.
    const name = sql<string>`btrim(regexp_replace(${body.name}, '\\s+', ' ', 'g'))`;
    // Conflict handling belongs in the DB: simultaneous retries keep the same row.
    const [row] = await this.db
      .insert(savedDrinks)
      .values({ userId, name })
      .onConflictDoUpdate({
        target: [savedDrinks.userId, savedDrinks.normalizedName],
        set: { name: sql`${savedDrinks.name}` },
      })
      .returning(savedColumns);
    return row;
  }

  @Delete('saved/:id')
  async remove(
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.db
      .delete(savedDrinks)
      .where(and(eq(savedDrinks.id, id), eq(savedDrinks.userId, userId)));
    return { deleted: true };
  }

  @Get('picks')
  picks(@UserId() userId: string) {
    return this.db.execute(sql`
      with friends as (
        select case when f.requester_id = ${userId} then f.addressee_id
                    else f.requester_id end as friend_id
        from friendships f
        where f.status = 'accepted'
          and ${userId} in (f.requester_id, f.addressee_id)
      )
      select btrim(e.normalized_drink_name) as normalized_name,
        (array_agg(coalesce(d.name, e.custom_drink_name)
          order by e.logged_at desc, e.created_at desc, e.id desc))[1] as name,
        array_agg(distinct p.username order by p.username) as recommenders,
        max(e.logged_at) as last_recommended_at
      from friends f
      join entries e on e.user_id = f.friend_id
      join profiles p on p.id = e.user_id
      left join drinks d on d.id = e.drink_id
      where e.recommended = true
        and btrim(e.normalized_drink_name) <> ''
        and not exists (
          select 1 from entries own where own.user_id = ${userId}
            and btrim(own.normalized_drink_name) = btrim(e.normalized_drink_name)
        )
      group by btrim(e.normalized_drink_name)
      order by count(distinct p.username) desc, last_recommended_at desc
      limit 20
    `);
  }

  @Get('passport')
  passport(@UserId() userId: string) {
    // ponytail: aggregate on read for a personal history; paginate if it grows large.
    return this.db.execute(sql`
      select normalized_name, name, first_logged_at, last_logged_at, times_logged, recommended
      from (
        select btrim(e.normalized_drink_name) as normalized_name,
          coalesce(d.name, e.custom_drink_name) as name,
          min(e.logged_at) over w as first_logged_at,
          e.logged_at as last_logged_at,
          (count(*) over w)::int as times_logged,
          e.recommended,
          row_number() over (partition by btrim(e.normalized_drink_name)
            order by e.logged_at desc, e.created_at desc, e.id desc) as rank
        from entries e left join drinks d on d.id = e.drink_id
        where e.user_id = ${userId} and btrim(e.normalized_drink_name) <> ''
        window w as (partition by btrim(e.normalized_drink_name))
      ) passport where rank = 1
      order by last_logged_at desc, normalized_name asc
    `);
  }
}
