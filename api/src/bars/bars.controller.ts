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
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { and, eq, sql } from 'drizzle-orm';
import { AuthGuard, UserId } from '../auth.guard';
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
@UseGuards(AuthGuard)
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
    return nearbyBars(lat, lng);
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

    // Refresh: menus expire after 30 days. A lookup still pending after
    // 2 minutes died (API restart, model error) and is retried.
    await this.db.delete(barMenus).where(
      and(
        eq(barMenus.barId, bar.id),
        sql`case when ${barMenus.status} = 'pending'
          then ${barMenus.createdAt} < now() - interval '2 minutes'
          else ${barMenus.fetchedAt} < now() - interval '30 days' end`,
      ),
    );

    const [menu] = await this.db
      .select()
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
    if (menu) return { status: menu.status };

    // Either an API key, or the OIDC token file Render writes for the
    // federation rule (the SDK reads both on its own).
    if (
      !process.env.ANTHROPIC_API_KEY &&
      !process.env.ANTHROPIC_IDENTITY_TOKEN_FILE
    ) {
      return { status: 'none' };
    }
    const [{ today, mine }] = await this.db
      .select({
        today: sql<number>`count(*)::int`,
        mine: sql<number>`(count(*) filter (where ${barMenus.requestedBy} = ${userId}))::int`,
      })
      .from(barMenus)
      .where(sql`${barMenus.createdAt} > now() - interval '1 day'`);
    if (today >= DAILY_LOOKUPS || mine >= DAILY_LOOKUPS_EACH) {
      return { status: 'none' };
    }

    // The primary key makes this the lock: of two members picking the same
    // bar at once, only the one whose insert lands starts a lookup.
    const started = await this.db
      .insert(barMenus)
      .values({ barId: bar.id, requestedBy: userId })
      .onConflictDoNothing()
      .returning({ barId: barMenus.barId });
    // ponytail: runs in this process, unawaited. A restart drops it and the
    // 2-minute rule above retries; move to a queue if lookups need to survive.
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
      // The row stays pending, so the next read after 2 minutes retries.
      this.logger.error(`Menu lookup failed for ${bar.id}`, error);
    }
  }
}
