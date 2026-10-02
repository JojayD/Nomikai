import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { AuthGuard, UserId } from './auth.guard';
import { DB, type Db } from './db';
import { entries, nightOuts } from './db/schema';
import { entryQuery, withSignedUrls } from './entry-rows';
import { StorageService } from './storage.service';
import { assertCanSee } from './visibility';

@Controller('night-outs')
@UseGuards(AuthGuard)
export class NightOutsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  /** Own recent sessions, for the log form's picker. */
  @Get()
  list(@UserId() userId: string, @Query('since') since?: string) {
    return this.db
      .select({ id: nightOuts.id, name: nightOuts.name })
      .from(nightOuts)
      .where(
        and(
          eq(nightOuts.userId, userId),
          ...(since ? [gte(nightOuts.startedAt, since)] : []),
        ),
      )
      .orderBy(desc(nightOuts.startedAt))
      .limit(20);
  }

  /** Friends resolve the label on feed and profile rows, so reads are friend-gated. */
  @Get(':id')
  async one(@UserId() viewerId: string, @Param('id') id: string) {
    const [row] = await this.db
      .select({
        id: nightOuts.id,
        user_id: nightOuts.userId,
        name: nightOuts.name,
        location: nightOuts.location,
        started_at: nightOuts.startedAt,
      })
      .from(nightOuts)
      .where(eq(nightOuts.id, id));
    if (!row) throw new NotFoundException('No such night out');
    await assertCanSee(this.db, viewerId, row.user_id);
    return row;
  }

  @Get(':id/entries')
  async entries(@UserId() viewerId: string, @Param('id') id: string) {
    const { user_id } = await this.one(viewerId, id);
    const rows = await entryQuery(this.db, viewerId)
      .where(and(eq(entries.nightOutId, id), eq(entries.userId, user_id)))
      .orderBy(asc(entries.loggedAt));
    return withSignedUrls(this.storage, rows);
  }
}
