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
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { and, desc, eq } from 'drizzle-orm';
import { AuthGuard, UserId } from './auth.guard';
import { DB, type Db } from './db';
import { drinks, entries, nightOuts } from './db/schema';
import { entryQuery, withSignedUrls } from './entry-rows';
import { StorageService } from './storage.service';
import { assertCanSee } from './visibility';

type EntryBody = {
  id?: string;
  drink_id: number | null;
  custom_drink_name: string | null;
  night_out_id: string | null;
  logged_at: string;
  location: string | null;
  note: string | null;
  recommended: boolean | null;
  new_night_out?: { id?: string; name: string; location: string | null } | null;
};

@Controller('entries')
@UseGuards(AuthGuard)
export class EntriesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  /** Own logging history, for ranking repeats above the curated list (F4). */
  @Get('history')
  history(@UserId() userId: string) {
    return this.db
      .select({
        drink_id: entries.drinkId,
        custom_drink_name: entries.customDrinkName,
        normalized_drink_name: entries.normalizedDrinkName,
      })
      .from(entries)
      .where(eq(entries.userId, userId));
  }

  /** A profile's history. Friend-gated, newest first. */
  @Get()
  async list(
    @UserId() viewerId: string,
    @Query('user_id') targetId: string,
    @Query('limit') limit = '30',
    @Query('offset') offset = '0',
  ) {
    await assertCanSee(this.db, viewerId, targetId);
    const rows = await entryQuery(this.db, viewerId)
      .where(eq(entries.userId, targetId))
      // logged_at ties at minute precision; created_at then id make the
      // order (and offset pagination) deterministic
      .orderBy(
        desc(entries.loggedAt),
        desc(entries.createdAt),
        desc(entries.id),
      )
      .limit(Math.min(Number(limit) || 30, 100))
      .offset(Number(offset) || 0);
    return withSignedUrls(this.storage, rows);
  }

  /** The edit form's seed: own entries only, since only the owner can edit. */
  @Get(':id')
  async one(@UserId() userId: string, @Param('id') id: string) {
    const [row] = await this.db
      .select({
        id: entries.id,
        drink_id: entries.drinkId,
        drink_name: drinks.name,
        custom_drink_name: entries.customDrinkName,
        night_out_id: entries.nightOutId,
        night_out_name: nightOuts.name,
        logged_at: entries.loggedAt,
        location: entries.location,
        note: entries.note,
        recommended: entries.recommended,
        photo_path: entries.photoPath,
      })
      .from(entries)
      .leftJoin(drinks, eq(drinks.id, entries.drinkId))
      .leftJoin(nightOuts, eq(nightOuts.id, entries.nightOutId))
      .where(and(eq(entries.id, id), eq(entries.userId, userId)));
    if (!row) throw new NotFoundException('No such entry');
    return row;
  }

  /**
   * "+ New night out" creates the night and the entry together, so a failed
   * insert cannot leave an orphan session behind.
   */
  @Post()
  create(@UserId() userId: string, @Body() body: EntryBody) {
    return this.db.transaction(async (tx) => {
      const nightOutId = await resolveNightOut(tx, userId, body);
      const [row] = await tx
        .insert(entries)
        .values({
          ...(body.id && { id: body.id }),
          userId,
          drinkId: body.drink_id,
          customDrinkName: body.custom_drink_name,
          nightOutId,
          loggedAt: body.logged_at,
          location: body.location,
          note: body.note,
          recommended: body.recommended,
          // overwritten by the entries_normalized_drink_name trigger
          normalizedDrinkName: '',
        })
        .returning({ id: entries.id });
      return row;
    });
  }

  @Patch(':id')
  update(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() body: EntryBody,
  ) {
    return this.db.transaction(async (tx) => {
      const nightOutId = await resolveNightOut(tx, userId, body);
      const [row] = await tx
        .update(entries)
        .set({
          drinkId: body.drink_id,
          customDrinkName: body.custom_drink_name,
          nightOutId,
          loggedAt: body.logged_at,
          location: body.location,
          note: body.note,
          recommended: body.recommended,
        })
        .where(and(eq(entries.id, id), eq(entries.userId, userId)))
        .returning({ id: entries.id });
      if (!row) throw new NotFoundException('No such entry');
      return row;
    });
  }

  @Delete(':id')
  async destroy(@UserId() userId: string, @Param('id') id: string) {
    const [row] = await this.db
      .delete(entries)
      .where(and(eq(entries.id, id), eq(entries.userId, userId)))
      .returning({ photoPath: entries.photoPath });
    if (!row) throw new NotFoundException('No such entry');
    if (row.photoPath) await this.storage.remove([row.photoPath]);
    return { deleted: true };
  }

  @Post(':id/photo')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file'))
  async setPhoto(
    @UserId() userId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.assertOwn(userId, id);
    // Path is derived, never supplied: an upload can only land in own folder.
    const path = `${userId}/${id}.jpg`;
    await this.storage.upload(path, file.buffer, 'image/jpeg');
    await this.db
      .update(entries)
      .set({ photoPath: path })
      .where(eq(entries.id, id));
    return { photo_path: path };
  }

  @Delete(':id/photo')
  async clearPhoto(@UserId() userId: string, @Param('id') id: string) {
    const [row] = await this.db
      .update(entries)
      .set({ photoPath: null })
      .where(and(eq(entries.id, id), eq(entries.userId, userId)))
      .returning({ photoPath: entries.photoPath });
    if (!row) throw new NotFoundException('No such entry');
    await this.storage.remove([`${userId}/${id}.jpg`]);
    return { photo_path: null };
  }

  private async assertOwn(userId: string, id: string) {
    const [row] = await this.db
      .select({ userId: entries.userId })
      .from(entries)
      .where(eq(entries.id, id));
    if (!row) throw new NotFoundException('No such entry');
    if (row.userId !== userId) throw new ForbiddenException('Not your entry');
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Creates the night out when the form asked for a new one; else passes the id through. */
async function resolveNightOut(
  tx: Tx,
  userId: string,
  body: EntryBody,
): Promise<string | null> {
  if (!body.new_night_out) return body.night_out_id;
  const { id, name, location } = body.new_night_out;
  // Stable client id + do-nothing keeps a save retry idempotent: after the
  // entry write commits but the photo step fails, retrying links the same
  // night instead of creating a duplicate orphan.
  const [night] = await tx
    .insert(nightOuts)
    .values({ ...(id && { id }), userId, name, location })
    .onConflictDoNothing()
    .returning({ id: nightOuts.id });
  return night?.id ?? id ?? null;
}
