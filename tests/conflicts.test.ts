import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { makeHarness, addItem, addPerson, pinClock, TODAY, type Harness } from './helpers/harness.ts';
import { addDays, setClock, today, overlaps, rangeLength } from '../server/dates.ts';
import * as L from '../server/domain/loans.ts';

let h: Harness | undefined;
afterEach(() => {
  h?.close();
  h = undefined;
  setClock(null);
});

const worker = join(import.meta.dirname, 'helpers', 'approve-worker.ts');
function race(dbFile: string, ownerId: string, kind: 'approve' | 'extension', id: string, startAt: number) {
  return new Promise<any>((resolve, reject) => {
    const child = spawn(process.execPath, [worker, dbFile, ownerId, kind, id, String(startAt)]);
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(out));
      }
    });
  });
}

describe('date policy', () => {
  it('treats ranges as inclusive calendar days', () => {
    expect(rangeLength('2026-06-01', '2026-06-01')).toBe(1);
    expect(rangeLength('2026-06-01', '2026-06-03')).toBe(3);
    expect(overlaps('2026-06-01', '2026-06-03', '2026-06-03', '2026-06-05')).toBe(true); // shared hand-back day
    expect(overlaps('2026-06-01', '2026-06-03', '2026-06-04', '2026-06-05')).toBe(false);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // DST change doesn't skew days
  });

  it('computes today in the community time zone, not UTC', () => {
    setClock(() => new Date('2026-06-16T02:00:00Z')); // 22:00 on the 15th in Toronto
    expect(today()).toBe('2026-06-15');
  });
});

describe('conflicting reservations', () => {
  it('lets overlapping requests wait side by side, but approves only one', async () => {
    pinClock();
    h = await makeHarness();
    const sam = await h.as('sam');
    // Seed: Priya (d+5..d+8) and Maya (d+6..d+9) both want Sam's tent.
    const pending = (await sam.get('/api/loans')).body.lending.filter((l: any) => l.item.id === 'item-tent');
    expect(pending.map((l: any) => l.status)).toEqual(['requested', 'requested']);
    const [first, second] = pending;
    const detail = (await sam.get(`/api/loans/${first.id}`)).body;
    expect(detail.overlapping).toHaveLength(1);

    expect((await sam.post(`/api/loans/${first.id}/approve`).send({})).status).toBe(200);
    const blocked = await sam.post(`/api/loans/${second.id}/approve`).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('booking_conflict');
    // The UI is told why, ahead of time.
    const view = (await sam.get(`/api/loans/${second.id}`)).body;
    const approveAction = view.actions.find((a: any) => a.key === 'approve');
    expect(approveAction.enabled).toBe(false);
    expect(approveAction.reason).toMatch(/Overlaps/);
    // Declining the blocked one still works.
    expect((await sam.post(`/api/loans/${second.id}/decline`).send({ note: 'Already booked, sorry!' })).status).toBe(200);
  });

  it('a cancelled reservation frees the dates for the other request', async () => {
    pinClock();
    h = await makeHarness();
    const sam = await h.as('sam');
    const [first, second] = (await sam.get('/api/loans')).body.lending.filter((l: any) => l.item.id === 'item-tent');
    await sam.post(`/api/loans/${first.id}/approve`).send({});
    await sam.post(`/api/loans/${first.id}/cancel`).send({ reason: 'Tent pole snapped' });
    expect((await sam.post(`/api/loans/${second.id}/approve`).send({})).status).toBe(200);
  });

  it('concurrent HTTP approvals of overlapping requests: exactly one wins', async () => {
    pinClock();
    h = await makeHarness();
    const owner = await h.as('priya');
    const ids: string[] = [];
    for (const [who, s, e] of [['sam', 2, 4], ['theo', 3, 5], ['maya', 4, 6]] as const) {
      const a = await h.as(who);
      const res = await a.post('/api/loans').send({ itemId: 'item-telescope', startDate: addDays(TODAY, s), endDate: addDays(TODAY, e) });
      ids.push(res.body.id);
    }
    const results = await Promise.all(ids.map((id) => owner.post(`/api/loans/${id}/approve`).send({})));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });

  it('separate processes racing to approve overlapping requests on one database: exactly one wins', async () => {
    // Real clock here: the workers are separate processes.
    h = await makeHarness({ seed: false });
    const borrowers = ['ben', 'cara', 'dev', 'eli', 'fay', 'gus'];
    for (const p of ['olive', ...borrowers]) addPerson(h.db, p);
    addItem(h.db, 'item-race', 'olive');
    const t = today();
    const ids = borrowers.map(
      (b, i) => L.requestLoan(h!.db, b, { itemId: 'item-race', startDate: addDays(t, 1 + (i % 2)), endDate: addDays(t, 3) }).id,
    );
    h.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

    const startAt = Date.now() + 1500;
    const outcomes = await Promise.all(ids.map((id) => race(h!.dbFile, 'olive', 'approve', id, startAt)));
    const winners = outcomes.filter((o) => o.ok);
    expect(winners).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok).every((o) => o.code === 'booking_conflict')).toBe(true);
    const approved = h.db.prepare(`SELECT count(*) n FROM loans WHERE item_id = 'item-race' AND status = 'approved'`).get() as any;
    expect(approved.n).toBe(1);
  }, 30000);

  it('the database itself refuses a second overlapping approval', async () => {
    pinClock();
    h = await makeHarness();
    const [first, second] = h.db.prepare(`SELECT id FROM loans WHERE item_id = 'item-tent' ORDER BY start_date`).all() as any[];
    h.db.prepare(`UPDATE loans SET status = 'approved' WHERE id = ?`).run(first.id);
    expect(() => h!.db.prepare(`UPDATE loans SET status = 'approved' WHERE id = ?`).run(second.id)).toThrow(/BOOKING_CONFLICT/);
  });
});

describe('extensions', () => {
  it('borrower proposes, owner accepts, due date moves and history records it', async () => {
    pinClock();
    h = await makeHarness();
    const sam = await h.as('sam');
    const theo = await h.as('theo');
    // Seed: Theo has Sam's trailer (due d+1) with a pending extension to d+4.
    const loan = (await sam.get('/api/loans')).body.lending.find((l: any) => l.item.id === 'item-trailer');
    expect(loan.pendingExtension.newEndDate).toBe(addDays(TODAY, 4));
    expect((await theo.post(`/api/extensions/${loan.pendingExtension.id}/accept`).send({})).status).toBe(403);
    const res = await sam.post(`/api/extensions/${loan.pendingExtension.id}/accept`).send({ note: 'Enjoy the weekend!' });
    expect(res.status).toBe(200);
    expect(res.body.endDate).toBe(addDays(TODAY, 4));
    expect(res.body.originalEndDate).toBe(addDays(TODAY, 1));
    expect(res.body.events.at(-1)).toMatchObject({ type: 'extension_accepted', actor: { id: 'sam' } });
    expect((await sam.post(`/api/extensions/${loan.pendingExtension.id}/decline`).send({})).status).toBe(409);
  });

  it('rejects a proposal that collides with someone else’s booking and suggests the latest possible date', async () => {
    pinClock();
    h = await makeHarness();
    const maya = await h.as('maya');
    // Seed: Maya has Priya's projector until d+2; Theo booked d+4..d+6.
    const loan = (await maya.get('/api/loans')).body.borrowing.find((l: any) => l.item.id === 'item-projector' && l.status === 'borrowed');
    const tooFar = await maya.post(`/api/loans/${loan.id}/extensions`).send({ endDate: addDays(TODAY, 5) });
    expect(tooFar.status).toBe(409);
    expect(tooFar.body.error.details.latestPossible).toBe(addDays(TODAY, 3));
    const ok = await maya.post(`/api/loans/${loan.id}/extensions`).send({ endDate: addDays(TODAY, 3), note: 'One more night?' });
    expect(ok.status).toBe(200);
    expect(ok.body.pendingExtension.newEndDate).toBe(addDays(TODAY, 3));
    // Only one open proposal at a time.
    expect((await maya.post(`/api/loans/${loan.id}/extensions`).send({ endDate: addDays(TODAY, 3) })).status).toBe(409);
  });

  it('acceptance rechecks conflicts that appeared after the proposal', async () => {
    pinClock();
    h = await makeHarness();
    const sam = await h.as('sam');
    const priya = await h.as('priya');
    const theo = await h.as('theo');
    // Sam has the telescope d0..d2 reserved and asks to keep it until d+6.
    const id = (await sam.post('/api/loans').send({ itemId: 'item-telescope', startDate: TODAY, endDate: addDays(TODAY, 2) })).body.id;
    await priya.post(`/api/loans/${id}/approve`).send({});
    const ext = (await sam.post(`/api/loans/${id}/extensions`).send({ endDate: addDays(TODAY, 6) })).body.pendingExtension;
    // Meanwhile Theo requests d+5..d+6 and Priya approves that first.
    const theoLoan = (await theo.post('/api/loans').send({ itemId: 'item-telescope', startDate: addDays(TODAY, 5), endDate: addDays(TODAY, 6) })).body.id;
    expect((await priya.post(`/api/loans/${theoLoan}/approve`).send({})).status).toBe(200);
    // The UI is warned, and the server refuses.
    const view = (await priya.get(`/api/loans/${id}`)).body;
    expect(view.actions.find((a: any) => a.key === 'accept_extension').enabled).toBe(false);
    const res = await priya.post(`/api/extensions/${ext.id}/accept`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('booking_conflict');
    expect((await priya.get(`/api/loans/${id}`)).body.endDate).toBe(addDays(TODAY, 2));
    // Declining still works and is recorded.
    const declined = await priya.post(`/api/extensions/${ext.id}/decline`).send({ note: 'Theo has it from the 20th' });
    expect(declined.body.extensions[0]).toMatchObject({ status: 'declined', responseNote: 'Theo has it from the 20th' });
  });

  it('borrower can withdraw a proposal; overdue loans can still be extended', async () => {
    pinClock();
    h = await makeHarness();
    const sam = await h.as('sam');
    const drill = (await sam.get('/api/loans')).body.borrowing.find((l: any) => l.item.id === 'item-drill');
    expect(drill.overdue).toBe(true);
    const proposed = await sam.post(`/api/loans/${drill.id}/extensions`).send({ endDate: addDays(TODAY, 2), note: 'Shelves took longer' });
    expect(proposed.status).toBe(200);
    const maya = await h.as('maya');
    expect((await maya.post(`/api/extensions/${proposed.body.pendingExtension.id}/withdraw`).send({})).status).toBe(403);
    const w = await sam.post(`/api/extensions/${proposed.body.pendingExtension.id}/withdraw`).send({});
    expect(w.body.pendingExtension).toBeNull();
  });

  it('a racing extension acceptance and conflicting approval cannot both succeed', async () => {
    h = await makeHarness({ seed: false });
    for (const p of ['olive', 'ben', 'cara']) addPerson(h.db, p);
    addItem(h.db, 'item-x', 'olive');
    const t = today();
    const loan = L.requestLoan(h.db, 'ben', { itemId: 'item-x', startDate: addDays(t, 1), endDate: addDays(t, 2) }).id;
    L.approve(h.db, 'olive', loan, {});
    const ext = L.proposeExtension(h.db, 'ben', loan, { endDate: addDays(t, 6) }).pendingExtension!.id;
    const other = L.requestLoan(h.db, 'cara', { itemId: 'item-x', startDate: addDays(t, 5), endDate: addDays(t, 7) }).id;
    h.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const startAt = Date.now() + 1500;
    const results = await Promise.all([race(h.dbFile, 'olive', 'extension', ext, startAt), race(h.dbFile, 'olive', 'approve', other, startAt)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok).code).toBe('booking_conflict');
  }, 30000);
});

describe('double submission', () => {
  it('replays the first response for a repeated Idempotency-Key instead of acting twice', async () => {
    pinClock();
    h = await makeHarness();
    const sam = await h.as('sam');
    const body = { itemId: 'item-games', startDate: addDays(TODAY, 2), endDate: addDays(TODAY, 4) };
    const [a, b] = await Promise.all([
      sam.post('/api/loans').set('Idempotency-Key', 'k-123').send(body),
      sam.post('/api/loans').set('Idempotency-Key', 'k-123').send(body),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
    const count = h.db.prepare(`SELECT count(*) n FROM loans WHERE item_id = 'item-games'`).get() as any;
    expect(count.n).toBe(1);
    // Without the key, a second attempt is still caught as a duplicate.
    expect((await sam.post('/api/loans').send(body)).status).toBe(409);
  });

  it('a double-clicked approval acts once and answers consistently', async () => {
    pinClock();
    h = await makeHarness();
    const maya = await h.as('maya');
    const mixer = (await maya.get('/api/loans')).body.lending.find((l: any) => l.item.id === 'item-mixer');
    const [a, b] = await Promise.all([
      maya.post(`/api/loans/${mixer.id}/approve`).set('Idempotency-Key', 'approve-1').send({}),
      maya.post(`/api/loans/${mixer.id}/approve`).set('Idempotency-Key', 'approve-1').send({}),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const events = h.db.prepare(`SELECT count(*) n FROM loan_events WHERE loan_id = ? AND type = 'approved'`).get(mixer.id) as any;
    expect(events.n).toBe(1);
  });
});
