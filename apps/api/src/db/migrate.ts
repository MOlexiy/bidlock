import { config } from '../config';
import { Db } from './db';
import { migrate } from './migrator';

(async () => {
  const db = new Db(process.argv[2] ?? config.databaseUrl, 1);
  try {
    await migrate(db);
    console.log('migrations up to date');
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
