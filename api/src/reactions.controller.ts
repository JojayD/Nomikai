import {
  Controller,
  Delete,
  Inject,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { and, eq } from 'drizzle-orm';
import { UserId } from './auth.guard';
import { DB, type Db } from './db';
import { entries, reactions } from './db/schema';
import { assertCanSee } from './visibility';

/** F6: one reaction type, toggled with PUT/DELETE. Both are idempotent. */
@Controller('entries/:id/reaction')
export class ReactionsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Put()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async react(@UserId() userId: string, @Param('id') entryId: string) {
    const [entry] = await this.db
      .select({ userId: entries.userId })
      .from(entries)
      .where(eq(entries.id, entryId));
    if (!entry) throw new NotFoundException('No such entry');
    await assertCanSee(this.db, userId, entry.userId);
    await this.db
      .insert(reactions)
      .values({ entryId, userId })
      .onConflictDoNothing();
    return { reacted: true };
  }

  @Delete()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async unreact(@UserId() userId: string, @Param('id') entryId: string) {
    await this.db
      .delete(reactions)
      .where(and(eq(reactions.entryId, entryId), eq(reactions.userId, userId)));
    return { reacted: false };
  }
}
