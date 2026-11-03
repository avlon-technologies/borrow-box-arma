// Child process used by the concurrency tests: opens its own connection to the
// shared database file and tries to approve (or accept an extension) at an
// agreed instant, so several processes really do race each other.
import { openDatabase } from '../../server/db.ts';
import { approve, acceptExtension } from '../../server/domain/loans.ts';

const [dbFile, ownerId, kind, targetId, startAt] = process.argv.slice(2);
const db = openDatabase(dbFile);
const wait = Number(startAt) - Date.now();
setTimeout(() => {
  try {
    if (kind === 'approve') approve(db, ownerId, targetId, {});
    else acceptExtension(db, ownerId, targetId, {});
    process.stdout.write(JSON.stringify({ ok: true, targetId }));
  } catch (err: any) {
    process.stdout.write(JSON.stringify({ ok: false, targetId, code: err.code ?? String(err.message) }));
  } finally {
    db.close();
  }
}, Math.max(0, wait));
