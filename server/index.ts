import { join } from 'node:path';
import { createApp } from './app.ts';
import { defaultDataDir, openDatabase, ROOT } from './db.ts';
import { seed } from './seed.ts';
import { TIME_ZONE, today } from './dates.ts';

const dataDir = defaultDataDir();
const db = openDatabase(join(dataDir, 'borrowbox.db'));
if (seed(db, dataDir)) console.log('First run: seeded the demo community.');

const port = Number(process.env.PORT ?? 5174);
const app = createApp({ db, dataDir, webDir: join(ROOT, 'dist') });
const server = app.listen(port, () => {
  console.log(`BorrowBox is running at http://localhost:${port}`);
  console.log(`Community time zone: ${TIME_ZONE} (today is ${today()}) · data in ${dataDir}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
