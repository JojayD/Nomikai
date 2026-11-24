import { Controller, Get, Inject } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { DB, type Db } from './db';
import { drinks } from './db/schema';

@Controller('drinks')
export class DrinksController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The curated list. Read-only to clients; maintained via migrations. */
  @Get()
  list() {
    return this.db
      .select({
        id: drinks.id,
        name: drinks.name,
        normalized_name: drinks.normalizedName,
        is_alcoholic: drinks.isAlcoholic,
      })
      .from(drinks)
      .orderBy(asc(drinks.name));
  }
}
