import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { BlocksController } from './blocks.controller';
import { DbModule } from './db';
import { DrinksController } from './drinks.controller';
import { EntriesController } from './entries.controller';
import { FeedController } from './feed.controller';
import { FriendshipsController } from './friendships.controller';
import { LeaderboardController } from './leaderboard.controller';
import { NightOutsController } from './night-outs.controller';
import { ProfilesController } from './profiles.controller';
import { ReactionsController } from './reactions.controller';
import { RecapController } from './recap.controller';
import { StorageService } from './storage.service';

@Module({
  imports: [
    DbModule,
    // Per-IP backstop, generous enough for normal tapping around; the
    // abuse-prone writes carry tighter @Throttle overrides.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }] }),
  ],
  controllers: [
    ProfilesController,
    EntriesController,
    FeedController,
    FriendshipsController,
    NightOutsController,
    DrinksController,
    ReactionsController,
    BlocksController,
    LeaderboardController,
    RecapController,
  ],
  providers: [StorageService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
