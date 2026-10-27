import 'dotenv/config';

function bool(v: string | undefined, def: boolean) {
  return v === undefined ? def : ['1', 'true', 'yes'].includes(v.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://bidlock:bidlock@localhost:5432/bidlock',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  allowDevLogin: bool(process.env.ALLOW_DEV_LOGIN, true),
  startingBalance: 10_000,
};
