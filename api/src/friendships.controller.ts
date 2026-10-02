import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { aliasedTable, and, desc, eq, or } from 'drizzle-orm';
import { AuthGuard, UserId } from './auth.guard';
import { isBlockedPair } from './blocks.controller';
import { DB, type Db } from './db';
import { friendships, profiles } from './db/schema';

const requester = aliasedTable(profiles, 'requester');
const addressee = aliasedTable(profiles, 'addressee');

@Controller('friendships')
@UseGuards(AuthGuard)
export class FriendshipsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  private participant(userId: string) {
    return or(
      eq(friendships.requesterId, userId),
      eq(friendships.addresseeId, userId),
    );
  }

  @Get()
  list(@UserId() userId: string) {
    return this.db
      .select({
        id: friendships.id,
        requester_id: friendships.requesterId,
        addressee_id: friendships.addresseeId,
        status: friendships.status,
        requester: { username: requester.username },
        addressee: { username: addressee.username },
      })
      .from(friendships)
      .innerJoin(requester, eq(requester.id, friendships.requesterId))
      .innerJoin(addressee, eq(addressee.id, friendships.addresseeId))
      .where(this.participant(userId))
      .orderBy(desc(friendships.createdAt));
  }

  /** The one row for this pair, in either direction; null when there is none. */
  @Get('with/:profileId')
  async with(@UserId() userId: string, @Param('profileId') profileId: string) {
    const [row] = await this.db
      .select({
        id: friendships.id,
        requester_id: friendships.requesterId,
        status: friendships.status,
      })
      .from(friendships)
      .where(
        and(
          this.participant(userId),
          or(
            eq(friendships.requesterId, profileId),
            eq(friendships.addresseeId, profileId),
          ),
        ),
      );
    return row ?? null;
  }

  /** Send a request, by username or by profile id (the invite-link path). */
  @Post()
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  async send(
    @UserId() userId: string,
    @Body() body: { username?: string; addressee_id?: string },
  ) {
    let addresseeId = body.addressee_id;
    if (!addresseeId) {
      const name = (body.username ?? '').trim().toLowerCase();
      const [target] = await this.db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.username, name));
      if (!target) throw new NotFoundException(`No user named @${name}.`);
      addresseeId = target.id;
    }
    // Same message either way round: don't reveal who blocked whom.
    if (await isBlockedPair(this.db, userId, addresseeId)) {
      throw new ForbiddenException('You cannot add this user.');
    }
    const [row] = await this.db
      .insert(friendships)
      .values({ requesterId: userId, addresseeId })
      .returning({ id: friendships.id });
    return row;
  }

  /**
   * The only legal transition is pending -> accepted by the addressee; the
   * where clause makes sure the friendships_accept trigger never sees another.
   */
  @Patch(':id')
  async accept(@UserId() userId: string, @Param('id') id: string) {
    const [row] = await this.db
      .update(friendships)
      .set({ status: 'accepted' })
      .where(
        and(
          eq(friendships.id, id),
          eq(friendships.addresseeId, userId),
          eq(friendships.status, 'pending'),
        ),
      )
      .returning({ id: friendships.id });
    if (!row) throw new NotFoundException('No pending request to accept');
    return row;
  }

  /**
   * Decline (addressee), cancel (requester), and unfriend (either) are all
   * this delete. It revokes visibility immediately and deletes no data.
   */
  @Delete(':id')
  async remove(@UserId() userId: string, @Param('id') id: string) {
    const [row] = await this.db
      .delete(friendships)
      .where(and(eq(friendships.id, id), this.participant(userId)))
      .returning({ id: friendships.id });
    if (!row) throw new NotFoundException('No such friendship');
    return { deleted: true };
  }
}
