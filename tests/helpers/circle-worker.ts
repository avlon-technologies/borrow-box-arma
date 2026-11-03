// Child process for the circle race test: at an agreed instant, either remove a
// member from a circle or have that member ask for a circle-only item.
import { openDatabase } from '../../server/db.ts';
import { setClock } from '../../server/dates.ts';
import { requestLoan } from '../../server/domain/loans.ts';
import { removeMember } from '../../server/domain/circles.ts';

const [dbFile, kind, actor, a, b, c, startAt, now] = process.argv.slice(2);
setClock(() => new Date(now));
const db = openDatabase(dbFile);
setTimeout(() => {
  try {
    if (kind === 'remove') removeMember(db, actor, a, b);
    else requestLoan(db, actor, { itemId: a, startDate: b, endDate: c });
    process.stdout.write(JSON.stringify({ ok: true, kind }));
  } catch (err: any) {
    process.stdout.write(JSON.stringify({ ok: false, kind, code: err.code ?? String(err.message) }));
  } finally {
    db.close();
  }
}, Math.max(0, Number(startAt) - Date.now()));
