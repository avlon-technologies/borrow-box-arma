import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, pinClock, TODAY, type Harness } from './helpers/harness.ts';
import { addDays } from '../server/dates.ts';
import { setClock } from '../server/dates.ts';

const d = (n: number) => addDays(TODAY, n);
let h: Harness;

beforeEach(async () => {
  pinClock();
  h = await makeHarness();
});
afterEach(() => {
  h.close();
  setClock(null);
});

const report = (condition = 'good', notes = '') => ({ condition, notes, photoIds: [] });

async function requestAs(borrower: string, itemId: string, start: number, end: number, note = '') {
  const a = await h.as(borrower);
  return a.post('/api/loans').send({ itemId, startDate: d(start), endDate: d(end), note });
}

describe('requesting', () => {
  it('a borrower requests dates with a note and sees the pending request after reloading', async () => {
    const sam = await h.as('sam');
    const res = await sam.post('/api/loans').send({ itemId: 'item-telescope', startDate: d(3), endDate: d(5), note: 'Meteor shower!' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('requested');
    expect(res.body.note).toBe('Meteor shower!');
    const again = await sam.get(`/api/loans/${res.body.id}`);
    expect(again.body.status).toBe('requested');
    const mine = await sam.get('/api/loans');
    expect(mine.body.borrowing.map((l: any) => l.id)).toContain(res.body.id);
    const item = await sam.get('/api/items/item-telescope');
    expect(item.body.myOpenLoans).toHaveLength(1);
  });

  it('rejects borrowing your own item on the server', async () => {
    const res = await requestAs('maya', 'item-drill', 10, 11);
    expect(res.status).toBe(403);
  });

  it('validates dates against today, order, and the item’s maximum', async () => {
    expect((await requestAs('sam', 'item-telescope', -1, 2)).status).toBe(400);
    expect((await requestAs('sam', 'item-telescope', 5, 3)).status).toBe(400);
    expect((await requestAs('sam', 'item-telescope', 3, 20)).body.error.message).toMatch(/up to 7 days/);
    const bad = await (await h.as('sam')).post('/api/loans').send({ itemId: 'item-telescope', startDate: '2026-02-30', endDate: '2026-03-01' });
    expect(bad.status).toBe(400);
  });

  it('prevents a duplicate overlapping request from the same person', async () => {
    expect((await requestAs('sam', 'item-telescope', 3, 5)).status).toBe(201);
    const dup = await requestAs('sam', 'item-telescope', 4, 6);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('duplicate_request');
  });

  it('allows overlapping pending requests from different people, but not over a confirmed booking', async () => {
    expect((await requestAs('sam', 'item-telescope', 3, 5)).status).toBe(201);
    expect((await requestAs('theo', 'item-telescope', 4, 6)).status).toBe(201);
    // Projector is confirmed for Theo d+4..d+6 in the seed.
    const res = await requestAs('sam', 'item-projector', 5, 5);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('booking_conflict');
  });
});

describe('owner decisions and authorization', () => {
  it('owner approves; borrower and strangers cannot', async () => {
    const id = (await requestAs('sam', 'item-telescope', 3, 5)).body.id;
    const sam = await h.as('sam');
    const theo = await h.as('theo');
    const priya = await h.as('priya');
    expect((await sam.post(`/api/loans/${id}/approve`).send({})).status).toBe(403);
    expect((await theo.post(`/api/loans/${id}/approve`).send({})).status).toBe(404);
    expect((await theo.get(`/api/loans/${id}`)).status).toBe(404);
    const ok = await priya.post(`/api/loans/${id}/approve`).send({ note: 'Enjoy!' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('approved');
    // Approving twice is an invalid transition.
    const twice = await priya.post(`/api/loans/${id}/approve`).send({});
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('illegal_transition');
  });

  it('owner declines with a note; declined requests cannot be approved or cancelled', async () => {
    const id = (await requestAs('sam', 'item-telescope', 3, 5)).body.id;
    const priya = await h.as('priya');
    const res = await priya.post(`/api/loans/${id}/decline`).send({ note: 'Sorry, I need it that week.' });
    expect(res.body.status).toBe('declined');
    expect(res.body.events.at(-1)).toMatchObject({ type: 'declined', actor: { id: 'priya' }, detail: { message: 'Sorry, I need it that week.' } });
    expect((await priya.post(`/api/loans/${id}/approve`).send({})).status).toBe(409);
    const sam = await h.as('sam');
    expect((await sam.post(`/api/loans/${id}/cancel`).send({})).status).toBe(409);
  });

  it('borrower can cancel a pending request; the owner declines instead', async () => {
    const id = (await requestAs('sam', 'item-telescope', 3, 5)).body.id;
    const priya = await h.as('priya');
    expect((await priya.post(`/api/loans/${id}/cancel`).send({})).status).toBe(409);
    const sam = await h.as('sam');
    const res = await sam.post(`/api/loans/${id}/cancel`).send({ reason: 'Plans changed' });
    expect(res.body.status).toBe('cancelled');
    expect((await priya.post(`/api/loans/${id}/approve`).send({})).status).toBe(409);
  });

  it('only the borrower confirms pickup and starts a return; only the owner marks ready and completes', async () => {
    const id = (await requestAs('sam', 'item-telescope', 0, 2)).body.id;
    const sam = await h.as('sam');
    const priya = await h.as('priya');
    await priya.post(`/api/loans/${id}/approve`).send({});
    expect((await sam.post(`/api/loans/${id}/ready`).send({})).status).toBe(403);
    expect((await sam.post(`/api/loans/${id}/pickup`).send({})).status).toBe(409); // not ready yet
    await priya.post(`/api/loans/${id}/ready`).send({});
    expect((await priya.post(`/api/loans/${id}/pickup`).send({})).status).toBe(403);
    await sam.post(`/api/loans/${id}/pickup`).send({});
    expect((await priya.post(`/api/loans/${id}/return`).send({ report: report() })).status).toBe(403);
    expect((await sam.post(`/api/loans/${id}/confirm-return`).send({ report: report() })).status).toBe(403);
    expect((await sam.post(`/api/loans/${id}/cancel`).send({})).status).toBe(409); // can't cancel once borrowed
  });

  it('requires a session for everything', async () => {
    const { default: request } = await import('supertest');
    const anon = request(h.app);
    expect((await anon.get('/api/items')).status).toBe(401);
    expect((await anon.post('/api/loans').send({})).status).toBe(401);
    expect((await anon.post('/api/session').send({ userId: 'nobody' })).status).toBe(400);
  });

  it('only the owner can edit or hide an item', async () => {
    const sam = await h.as('sam');
    const body = { title: 'Mine now', category: 'Tools', maxDays: 3 };
    expect((await sam.put('/api/items/item-drill').send(body)).status).toBe(403);
    expect((await sam.post('/api/items/item-drill/visibility').send({ hidden: true })).status).toBe(403);
    const maya = await h.as('maya');
    const edited = await maya.put('/api/items/item-drill').send({ ...body, title: 'Cordless drill' });
    expect(edited.status).toBe(200);
    expect(edited.body.title).toBe('Cordless drill');
  });
});

describe('handoff, use and return', () => {
  it('runs the full journey with an attributable history and separate condition accounts', async () => {
    const sam = await h.as('sam');
    const priya = await h.as('priya');
    const id = (await sam.post('/api/loans').send({ itemId: 'item-telescope', startDate: d(0), endDate: d(3), note: 'Saturn!' })).body.id;
    await priya.post(`/api/loans/${id}/approve`).send({});
    await priya.post(`/api/loans/${id}/ready`).send({ note: 'On the porch', report: report('like_new', 'Mirror cleaned') });
    await sam.post(`/api/loans/${id}/pickup`).send({ report: report('good', 'Tiny scratch on the tube') });
    const returning = await sam.post(`/api/loans/${id}/return`).send({ report: report('good', 'All parts back in the box') });
    expect(returning.body.status).toBe('returning');
    const done = await priya.post(`/api/loans/${id}/confirm-return`).send({
      report: { ...report('damaged', 'Finder scope bracket is bent'), agrees: false },
    });
    expect(done.body.status).toBe('returned');
    expect(done.body.disputed).toBe(true);

    const types = done.body.events.map((e: any) => [e.type, e.actor?.id]);
    expect(types).toEqual([
      ['requested', 'sam'],
      ['approved', 'priya'],
      ['ready', 'priya'],
      ['condition_reported', 'priya'],
      ['picked_up', 'sam'],
      ['condition_reported', 'sam'],
      ['return_started', 'sam'],
      ['condition_reported', 'sam'],
      ['returned', 'priya'],
      ['condition_reported', 'priya'],
    ]);
    const reports = done.body.reports.map((r: any) => [r.phase, r.role, r.author.id, r.condition, r.agrees]);
    expect(reports).toEqual([
      ['handoff', 'owner', 'priya', 'like_new', null],
      ['handoff', 'borrower', 'sam', 'good', null],
      ['return', 'borrower', 'sam', 'good', null],
      ['return', 'owner', 'priya', 'damaged', false],
    ]);

    // The borrower can respond — appended, never replacing anything.
    const follow = await sam.post(`/api/loans/${id}/followup`).send({ report: report('worn', 'It was like that when I got it') });
    expect(follow.body.reports).toHaveLength(5);
    expect(follow.body.reports[2].notes).toBe('All parts back in the box');
  });

  it('evidence and history are append-only at the database level', async () => {
    const row = h.db.prepare(`SELECT id FROM condition_reports LIMIT 1`).get() as any;
    expect(() => h.db.prepare(`UPDATE condition_reports SET notes = 'edited' WHERE id = ?`).run(row.id)).toThrow(/APPEND_ONLY/);
    expect(() => h.db.prepare(`DELETE FROM condition_reports WHERE id = ?`).run(row.id)).toThrow(/APPEND_ONLY/);
    expect(() => h.db.prepare(`UPDATE loan_events SET actor_id = 'theo'`).run()).toThrow(/APPEND_ONLY/);
    expect(() => h.db.prepare(`DELETE FROM loan_events`).run()).toThrow(/APPEND_ONLY/);
  });

  it('the database refuses illegal status jumps even if application code tried one', async () => {
    const id = (await requestAs('sam', 'item-telescope', 1, 2)).body.id;
    expect(() => h.db.prepare(`UPDATE loans SET status = 'returned' WHERE id = ?`).run(id)).toThrow(/ILLEGAL_TRANSITION/);
    expect(() => h.db.prepare(`UPDATE loans SET borrower_id = 'theo' WHERE id = ?`).run(id)).toThrow(/IMMUTABLE_FIELD/);
  });

  it('owner can confirm a return the borrower forgot to start', async () => {
    const maya = await h.as('maya');
    // Seed: Sam has the drill (borrowed, overdue).
    const loan = (await maya.get('/api/loans')).body.lending.find((l: any) => l.item.id === 'item-drill' && l.status === 'borrowed');
    const res = await maya.post(`/api/loans/${loan.id}/confirm-return`).send({ report: report('good', 'Found it on my porch') });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('returned');
    expect(res.body.reports.at(-1).agrees).toBeNull();
  });
});

describe('overdue loans', () => {
  it('shows an overdue indicator and stays returnable', async () => {
    const sam = await h.as('sam');
    const loan = (await sam.get('/api/loans')).body.borrowing.find((l: any) => l.item.id === 'item-drill');
    expect(loan.status).toBe('borrowed');
    expect(loan.overdue).toBe(true);
    expect(loan.daysLate).toBe(2);
    expect(loan.needsAttention).toBe(true);
    const back = await sam.post(`/api/loans/${loan.id}/return`).send({ report: report('good', 'Sorry it’s late!') });
    expect(back.status).toBe(200);
    expect(back.body.events.find((e: any) => e.type === 'return_started').detail.lateByDays).toBe(2);
  });

  it('becomes overdue the day after the due date in the community time zone', async () => {
    const sam = await h.as('sam');
    const priya = await h.as('priya');
    const id = (await sam.post('/api/loans').send({ itemId: 'item-telescope', startDate: d(0), endDate: d(1) })).body.id;
    await priya.post(`/api/loans/${id}/approve`).send({});
    await priya.post(`/api/loans/${id}/ready`).send({});
    await sam.post(`/api/loans/${id}/pickup`).send({});
    // 23:30 Toronto on the due date is 03:30Z the next UTC day — still not late.
    pinClock(`${d(2)}T03:30:00Z`);
    expect((await sam.get(`/api/loans/${id}`)).body).toMatchObject({ overdue: false, dueToday: true });
    pinClock(`${d(2)}T05:30:00Z`); // 00:30 Toronto the next day
    expect((await sam.get(`/api/loans/${id}`)).body).toMatchObject({ overdue: true, daysLate: 1 });
  });
});

describe('hiding items', () => {
  it('hidden items leave the catalog and refuse new requests, but keep existing reservations', async () => {
    const theo = await h.as('theo');
    const priya = await h.as('priya');
    // Seed: washer is hidden with Priya's approved reservation.
    const catalog = (await priya.get('/api/items')).body.map((i: any) => i.id);
    expect(catalog).not.toContain('item-washer');
    const res = await requestAs('sam', 'item-washer', 10, 10);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('item_hidden');
    const reservation = (await priya.get('/api/loans')).body.borrowing.find((l: any) => l.item.id === 'item-washer');
    expect(reservation.status).toBe('approved');
    // Priya can still see it; a stranger gets a gentle "resting" answer.
    expect((await priya.get('/api/items/item-washer')).status).toBe(200);
    const sam = await h.as('sam');
    expect((await sam.get('/api/items/item-washer')).body.error.code).toBe('item_resting');
    // The reservation can still move forward.
    expect((await theo.post(`/api/loans/${reservation.id}/ready`).send({})).body.status).toBe('ready');
    // Hiding an item with an active reservation does not cancel it.
    const maya = await h.as('maya');
    const paddle = (await maya.get('/api/loans')).body.borrowing.find((l: any) => l.item.id === 'item-paddle');
    const samOwner = await h.as('sam');
    await samOwner.post('/api/items/item-paddle/visibility').send({ hidden: true });
    expect((await maya.get(`/api/loans/${paddle.id}`)).body.status).toBe('ready');
    // Showing it again re-opens requests.
    await theo.post('/api/items/item-washer/visibility').send({ hidden: false });
    expect((await requestAs('sam', 'item-washer', 10, 10)).status).toBe(201);
  });
});

describe('items', () => {
  it('owners create and edit items; the catalog searches and filters', async () => {
    const theo = await h.as('theo');
    const created = await theo.post('/api/items').send({
      title: 'Tile saw', description: 'Wet tile saw for bathroom projects', category: 'Tools', maxDays: 3, pickupNotes: 'Garage', careNotes: '',
    });
    expect(created.status).toBe(201);
    expect(created.body.owner.id).toBe('theo');
    const sam = await h.as('sam');
    expect((await sam.get('/api/items?q=tile')).body.map((i: any) => i.id)).toEqual([created.body.id]);
    expect((await sam.get('/api/items?q=bathroom saw')).body).toHaveLength(1);
    const tools = (await sam.get('/api/items?category=Tools')).body;
    expect(tools.every((i: any) => i.category === 'Tools')).toBe(true);
    const free = (await sam.get('/api/items?available=now')).body;
    expect(free.find((i: any) => i.id === 'item-drill')).toBeUndefined(); // Sam has it
    expect((await theo.post('/api/items').send({ title: '', category: 'Nope', maxDays: 0 })).status).toBe(400);
  });

  it('uploads accept real images only and can’t be borrowed by other people', async () => {
    const theo = await h.as('theo');
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const up = await theo.post('/api/uploads').set('Content-Type', 'image/png').send(png);
    expect(up.status).toBe(201);
    const fake = await theo.post('/api/uploads').set('Content-Type', 'image/png').send(Buffer.from('not really an image at all'));
    expect(fake.status).toBe(400);
    const maya = await h.as('maya');
    const steal = await maya.put('/api/items/item-drill').send({ title: 'Drill', category: 'Tools', maxDays: 3, image: up.body.id });
    expect(steal.status).toBe(403);
    const ok = await theo.put('/api/items/item-tables').send({ title: 'Tables', category: 'Party', maxDays: 3, image: up.body.id });
    expect(ok.body.imageUrl).toBe(up.body.url);
    expect((await theo.get(up.body.url)).status).toBe(200);
  });
});
