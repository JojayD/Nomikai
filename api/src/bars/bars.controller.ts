import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { and, eq, sql } from 'drizzle-orm';
import { UserId } from '../auth.guard';
import { DB, type Db } from '../db';
import { barMenuItems, barMenus } from '../db/schema';
import { lookupMenu } from './menu-agent';
import { type Bar, barById, nearbyBars, searchBars } from './search';

// New web lookups per rolling day: across all members, and started by one
// member (a night out is a handful of bars, and most are already cached).
// Over either, bars we have not seen answer "none" without calling the model.
const DAILY_LOOKUPS = 20;
const DAILY_LOOKUPS_EACH = 5;

@Controller('bars')
export class BarsController {
  private readonly logger = new Logger(BarsController.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(@Query('q') query: unknown) {
    return searchBars(typeof query === 'string' ? query : '');
  }

  // POST so the coordinates stay out of URLs and access logs. Nothing is stored.
  @Post('nearby')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  nearby(@Body() body: { lat?: unknown; lng?: unknown } | undefined) {
    const { lat, lng } = body ?? {};
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      !(Math.abs(lat) <= 90) ||
      !(Math.abs(lng) <= 180)
    ) {
      throw new BadRequestException('Send lat and lng as numbers.');
    }
    // The member is probably standing in one of the closest bars, so the web
    // app starts those menu lookups while the list is still being read. Phone
    // positions are off by tens of metres indoors, hence 75 m and not less.
    const close = nearbyBars(lat, lng, 75).slice(0, 2);
    return nearbyBars(lat, lng).map((bar) => ({
      ...bar,
      prefetch: close.includes(bar),
    }));
  }

  // The web app polls this while a lookup runs.
  @Get(':type/:id/menu')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async menu(
    @UserId() userId: string,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    const bar = barById(`${type}/${id}`);
    if (!bar) throw new NotFoundException('Unknown bar.');

    // Refresh: menus expire after 30 days. A lookup that failed (API restart,
    // model error) keeps its pending row for a day before it is retried, so
    // every model call is still there for the daily caps to count.
    await this.db.delete(barMenus).where(
      and(
        eq(barMenus.barId, bar.id),
        sql`case when ${barMenus.status} = 'pending'
          then ${barMenus.createdAt} < now() - interval '1 day'
          else ${barMenus.fetchedAt} < now() - interval '30 days' end`,
      ),
    );

    const [menu] = await this.db
      .select({
        status: barMenus.status,
        sourceUrls: barMenus.sourceUrls,
        // nobody is still waiting on it; it may yet finish and turn ready
        overdue: sql<boolean>`${barMenus.createdAt} < now() - interval '2 minutes'`,
      })
      .from(barMenus)
      .where(eq(barMenus.barId, bar.id));
    if (menu?.status === 'ready') {
      const items = await this.db
        .select({
          name: barMenuItems.name,
          is_alcoholic: barMenuItems.isAlcoholic,
          category: barMenuItems.category,
        })
        .from(barMenuItems)
        .where(eq(barMenuItems.barId, bar.id))
        .orderBy(barMenuItems.id);
      return { status: 'ready', items, sourceUrls: menu.sourceUrls };
    }
    if (menu) {
      const gaveUp = menu.status === 'pending' && menu.overdue;
      return { status: gaveUp ? 'none' : menu.status };
    }

    // Either an API key, or the OIDC token file Render writes for the
    // federation rule (the SDK reads both on its own).
    if (
      !process.env.ANTHROPIC_API_KEY &&
      !process.env.ANTHROPIC_IDENTITY_TOKEN_FILE
    ) {
      return { status: 'none' };
    }
    const started = await this.db.transaction(async (tx) => {
      // One at a time, or parallel requests all count before any inserts and
      // slip past the caps together.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('bar_menu_lookups'))`,
      );
      const [{ today, mine }] = await tx
        .select({
          today: sql<number>`count(*)::int`,
          mine: sql<number>`(count(*) filter (where ${barMenus.requestedBy} = ${userId}))::int`,
        })
        .from(barMenus)
        .where(sql`${barMenus.createdAt} > now() - interval '1 day'`);
      if (today >= DAILY_LOOKUPS || mine >= DAILY_LOOKUPS_EACH) return null;
      // Of two members picking the same bar at once, only the one whose
      // insert lands starts a lookup.
      return tx
        .insert(barMenus)
        .values({ barId: bar.id, requestedBy: userId })
        .onConflictDoNothing()
        .returning({ barId: barMenus.barId });
    });
    if (!started) return { status: 'none' };
    // ponytail: runs in this process, unawaited. A restart drops it and the
    // 1-day rule above retries; move to a queue if lookups need to survive.
    if (started.length) void this.lookup(bar);
    return { status: 'pending' };
  }

  private async lookup(bar: Bar) {
    try {
      const found = await lookupMenu(bar);
      const done = { fetchedAt: sql`now()` };
      await this.db.transaction(async (tx) => {
        if (found) {
          await tx
            .insert(barMenuItems)
            .values(found.items.map((item) => ({ barId: bar.id, ...item })))
            .onConflictDoNothing();
        }
        await tx
          .update(barMenus)
          .set(
            found
              ? { status: 'ready', sourceUrls: found.sourceUrls, ...done }
              : { status: 'none', ...done },
          )
          .where(eq(barMenus.barId, bar.id));
      });
    } catch (error) {
      // The row stays pending, so a read after a day retries.
      this.logger.error(`Menu lookup failed for ${bar.id}`, error);
    }
  }
}
