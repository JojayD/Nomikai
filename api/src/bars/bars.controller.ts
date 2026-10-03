import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth.guard';
import { searchBars } from './search';

@Controller('bars')
@UseGuards(AuthGuard)
export class BarsController {
  @Get()
  list(@Query('q') query: unknown) {
    return searchBars(typeof query === 'string' ? query : '');
  }
}
