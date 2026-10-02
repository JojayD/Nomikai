import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { eq, sql } from 'drizzle-orm';
import { AuthGuard, UserEmail, UserId } from './auth.guard';
import { DB, type Db } from './db';
import { entries, profiles } from './db/schema';
import { StorageService } from './storage.service';
import { assertCanSee } from './visibility';

const publicColumns = {
  id: profiles.id,
  username: profiles.username,
  avatar_url: profiles.avatarUrl,
  user_code: profiles.userCode,
  timezone: profiles.timezone,
};

@Controller()
@UseGuards(AuthGuard)
export class ProfilesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  /** The photos bucket is private, so avatars ship as short-lived signed URLs. */
  private async withAvatar<T extends { avatar_url: string | null }>(row: T) {
    const signed = await this.storage.sign([row.avatar_url]);
    return {
      ...row,
      avatar_src: row.avatar_url ? (signed.get(row.avatar_url) ?? null) : null,
    };
  }

  /** null when the account has no profile yet — the web app sends those to onboarding. */
  @Get('me')
  async me(@UserId() userId: string, @UserEmail() email: string | null) {
    const [row] = await this.db
      .select({
        ...publicColumns,
        leaderboard_opt_in: profiles.leaderboardOptIn,
      })
      .from(profiles)
      .where(eq(profiles.id, userId));
    return row ? { ...(await this.withAvatar(row)), email } : null;
  }

  @Post('me')
  async create(
    @UserId() userId: string,
    @Body() body: { username?: string; timezone?: string },
  ) {
    const [row] = await this.db
      .insert(profiles)
      .values({
        id: userId,
        username: body.username!,
        timezone: body.timezone!,
        ageAttestedAt: new Date().toISOString(),
      })
      .returning(publicColumns);
    return row;
  }

  // user_code and age_attested_at stay immutable, as the column grants enforced.
  @Patch('me')
  async update(
    @UserId() userId: string,
    @Body()
    body: {
      username?: string;
      timezone?: string;
      leaderboard_opt_in?: boolean;
    },
  ) {
    const [row] = await this.db
      .update(profiles)
      .set({
        ...(body.username !== undefined && { username: body.username }),
        ...(body.timezone !== undefined && { timezone: body.timezone }),
        ...(body.leaderboard_opt_in !== undefined && {
          leaderboardOptIn: body.leaderboard_opt_in,
        }),
      })
      .where(eq(profiles.id, userId))
      .returning(publicColumns);
    if (!row) throw new NotFoundException('No profile');
    return row;
  }

  @Post('me/avatar')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file'))
  async avatar(
    @UserId() userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    // Path is derived, never supplied: an upload can only land in own folder.
    const path = `${userId}/avatar.jpg`;
    await this.storage.upload(path, file.buffer, 'image/jpeg');
    // avatar_url stores the storage path; renders go through signed URLs
    await this.db
      .update(profiles)
      .set({ avatarUrl: path })
      .where(eq(profiles.id, userId));
    return { avatar_url: path };
  }

  /**
   * §3: everything goes. Deleting the auth user cascades the rows; storage
   * objects are not covered by the cascade, so the folder is emptied first.
   */
  @Delete('me')
  async destroy(@UserId() userId: string) {
    await this.storage.removeFolder(userId);
    await this.storage.deleteAuthUser(userId);
    return { deleted: true };
  }

  @Get('invite/:code')
  async byCode(@Param('code') code: string) {
    const [row] = await this.db
      .select({ username: profiles.username })
      .from(profiles)
      .where(eq(profiles.userCode, code));
    if (!row) throw new NotFoundException('No such invite code');
    return row;
  }

  @Get('profiles/:username')
  async byUsername(@Param('username') username: string) {
    const [row] = await this.db
      .select(publicColumns)
      .from(profiles)
      .where(eq(profiles.username, username));
    if (!row) throw new NotFoundException('No such user');
    return this.withAvatar(row);
  }

  /**
   * nights_out is the label-independent metric: distinct 4am-to-4am windows in
   * the profile owner's timezone (MVP doc section 3).
   */
  @Get('profiles/:id/stats')
  async stats(@UserId() viewerId: string, @Param('id') id: string) {
    await assertCanSee(this.db, viewerId, id);
    const [row] = await this.db
      .select({
        total_entries: sql<number>`count(*)::int`,
        unique_drinks: sql<number>`count(distinct coalesce(${entries.drinkId}::text, ${entries.normalizedDrinkName}))::int`,
        nights_out: sql<number>`count(distinct ((${entries.loggedAt} at time zone ${profiles.timezone} - interval '4 hours')::date))::int`,
      })
      .from(entries)
      .innerJoin(profiles, eq(profiles.id, entries.userId))
      .where(eq(entries.userId, id));
    return row;
  }
}
