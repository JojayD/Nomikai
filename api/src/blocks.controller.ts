import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { AuthGuard, UserId } from './auth.guard';
import { DB, type Db } from './db';
import { blocks, friendships, profiles } from './db/schema';

/**
 * F10, block only (a report queue nobody reads is worse than no button).
 * Blocking deletes the friendship in the same transaction, which is what hides
 * content in both directions: feed, profile, and leaderboard visibility are
 * all friendship-gated. The block row's job is to stop re-friending.
 */
@Controller('blocks')
@UseGuards(AuthGuard)
export class BlocksController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(@UserId() userId: string) {
    return this.db
      .select({
        blocked_id: blocks.blockedId,
        username: profiles.username,
        created_at: blocks.createdAt,
      })
      .from(blocks)
      .innerJoin(profiles, eq(profiles.id, blocks.blockedId))
      .where(eq(blocks.blockerId, userId))
      .orderBy(desc(blocks.createdAt));
  }

  @Post()
  async block(@UserId() userId: string, @Body() body: { blocked_id: string }) {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(blocks)
        .values({ blockerId: userId, blockedId: body.blocked_id })
        .onConflictDoNothing();
      await tx
        .delete(friendships)
        .where(
          or(
            and(
              eq(friendships.requesterId, userId),
              eq(friendships.addresseeId, body.blocked_id),
            ),
            and(
              eq(friendships.requesterId, body.blocked_id),
              eq(friendships.addresseeId, userId),
            ),
          ),
        );
    });
    return { blocked: true };
  }

  @Delete(':blockedId')
  async unblock(
    @UserId() userId: string,
    @Param('blockedId') blockedId: string,
  ) {
    const [row] = await this.db
      .delete(blocks)
      .where(and(eq(blocks.blockerId, userId), eq(blocks.blockedId, blockedId)))
      .returning({ ok: sql<number>`1` });
    if (!row) throw new NotFoundException('Not blocked');
    return { blocked: false };
  }
}

/** True when either side has blocked the other. */
export async function isBlockedPair(db: Db, a: string, b: string) {
  const [row] = await db
    .select({ ok: sql<number>`1` })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1);
  return !!row;
}
