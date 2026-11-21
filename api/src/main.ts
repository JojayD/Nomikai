import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { PgErrorFilter } from './pg-error.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // How many proxies sit in front of the API (Render: set TRUST_PROXY). Without
  // it every request carries the proxy's address and all members share one
  // rate-limit bucket. Too high a number lets a client fake its address.
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 0);
  app.useGlobalFilters(new PgErrorFilter());
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
