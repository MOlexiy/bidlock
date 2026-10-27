import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainErrorFilter } from './common/domain-error.filter';
import { config } from './config';
import { Db } from './db/db';
import { migrate } from './db/migrator';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await migrate(app.get(Db), (m) => Logger.log(m, 'Migrator'));
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalFilters(new DomainErrorFilter());
  app.enableShutdownHooks();
  await app.listen(config.port);
  Logger.log(`bidlock api on http://localhost:${config.port}/api`, 'Bootstrap');
}

void bootstrap();
