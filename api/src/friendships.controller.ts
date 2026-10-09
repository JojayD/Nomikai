import {
  BadRequestException,
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
import { isBlockedPair, lockProfilePair } from './blocks.controller';
import { DB, type Db } from './db';
import { friendships, profiles } from './db/schema';
import { StorageService } from './storage.service';

const requester = aliasedTable(profiles, 'requester');
const addressee = aliasedTable(profiles, 'addressee');

@Controller('friendships')
@UseGuards(AuthGuard)
export class FriendshipsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  private participant(userId: string) {
    return or(
      eq(friendships.requesterId, userId),
      eq(friendships.addresseeId, userId),
    );
  }

  /** Both sides carry a signed avatar so the friends page renders like every other user list. */
  @Get()
  async list(@UserId() userId: string) {
    const rows = await this.db
      .select({
        id: friendships.id,
        requester_id: friendships.requesterId,
        addressee_id: friendships.addresseeId,
        status: friendships.status,
        requester: {
          username: requester.username,
          avatar_url: requester.avatarUrl,
        },
        addressee: {
          username: addressee.username,
          avatar_url: addressee.avatarUrl,
        },
      })
      .from(friendships)
      .innerJoin(requester, eq(requester.id, friendships.requesterId))
      .innerJoin(addressee, eq(addressee.id, friendships.addresseeId))
      .where(this.participant(userId))
      .orderBy(desc(friendships.createdAt));
    const signed = await this.storage.sign(
      rows.flatMap((r) => [r.requester.avatar_url, r.addressee.avatar_url]),
    );
    const src = (path: string | null) =>
      path ? (signed.get(path) ?? null) : null;
    return rows.map((r) => ({
      ...r,
      requester: {
        username: r.requester.username,
        avatar_src: src(r.requester.avatar_url),
      },
      addressee: {
        username: r.addressee.username,
        avatar_src: src(r.addressee.avatar_url),
      },
    }));
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
      if (typeof body.username !== 'string')
        throw new BadRequestException('Enter a username.');
      const name = body.username.trim().toLowerCase();
      const [target] = await this.db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.username, name));
      if (!target) throw new NotFoundException(`No user named @${name}.`);
      addresseeId = target.id;
    }
    const targetId = addresseeId;
    return this.db.transaction(async (tx) => {
      await lockProfilePair(tx, userId, targetId);
      // Same message either way round: don't reveal who blocked whom.
      if (await isBlockedPair(tx, userId, targetId)) {
        throw new ForbiddenException('You cannot add this user.');
      }
      const [row] = await tx
        .insert(friendships)
        .values({ requesterId: userId, addresseeId: targetId })
        .returning({ id: friendships.id });
      return row;
    });
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
