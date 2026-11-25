import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { UserId } from './auth.guard';
import { DB, type Db } from './db';
import { comments, entries, profiles } from './db/schema';
import { assertCanSee } from './visibility';

/** Comments follow the entry: whoever may see the entry may read and write them. */
@Controller('entries/:id/comments')
export class CommentsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async entryOwner(viewerId: string, entryId: string) {
    const [entry] = await this.db
      .select({ userId: entries.userId })
      .from(entries)
      .where(eq(entries.id, entryId));
    if (!entry) throw new NotFoundException('No such entry');
    await assertCanSee(this.db, viewerId, entry.userId);
    return entry.userId;
  }

  @Get()
  async list(@UserId() viewerId: string, @Param('id') entryId: string) {
    await this.entryOwner(viewerId, entryId);
    return (
      this.db
        .select({
          id: comments.id,
          user_id: comments.userId,
          username: profiles.username,
          body: comments.body,
          created_at: comments.createdAt,
        })
        .from(comments)
        .innerJoin(profiles, eq(profiles.id, comments.userId))
        .where(
          and(
            eq(comments.entryId, entryId),
            // two friends of the author may have blocked each other
            sql`not exists (select 1 from blocks b
              where (b.blocker_id, b.blocked_id) in
                ((${viewerId}::uuid, ${comments.userId}), (${comments.userId}, ${viewerId}::uuid)))`,
          ),
        )
        .orderBy(asc(comments.createdAt))
        // ponytail: no paging; add it when an entry gets more than 200 comments
        .limit(200)
    );
  }

  @Post()
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  async add(
    @UserId() userId: string,
    @Param('id') entryId: string,
    @Body() body: { body?: unknown },
  ) {
    if (typeof body?.body !== 'string') {
      throw new BadRequestException('body must be text');
    }
    await this.entryOwner(userId, entryId);
    // length is the table's check constraint (PgErrorFilter turns it into a 400)
    const [row] = await this.db
      .insert(comments)
      .values({ entryId, userId, body: body.body.trim() })
      .returning({ id: comments.id });
    return row;
  }

  /** The comment's author or the entry's owner may remove it. */
  @Delete(':commentId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async remove(
    @UserId() userId: string,
    @Param('id') entryId: string,
    @Param('commentId') commentId: string,
  ) {
    const [row] = await this.db
      .delete(comments)
      .where(
        and(
          eq(comments.id, commentId),
          eq(comments.entryId, entryId),
          or(
            eq(comments.userId, userId),
            sql`exists (select 1 from entries e where e.id = ${comments.entryId} and e.user_id = ${userId})`,
          ),
        ),
      )
      .returning({ id: comments.id });
    if (!row) throw new NotFoundException('No such comment');
    return { deleted: true };
  }
}
