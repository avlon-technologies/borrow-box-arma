import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { makeHarness, pinClock, FIXED_NOW, TODAY, type Harness } from './helpers/harness.ts';
import { addDays, setClock } from '../server/dates.ts';
import { openDatabase, SCHEMA_VERSION } from '../server/db.ts';
import * as L from '../server/domain/loans.ts';

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

const circleId = (name: string) => (h.db.prepare(`SELECT id FROM circles WHERE name = ?`).get(name) as any).id as string;
const status = (circle: string, user: string) =>
  (h.db.prepare(`SELECT status FROM circle_members WHERE circle_id = ? AND user_id = ?`).get(circle, user) as any)?.status;
const ask = async (who: string, itemId: string, start: number, end: number) =>
  (await h.as(who)).post('/api/loans').send({ itemId, startDate: d(start), endDate: d(end) });

describe('circles and membership', () => {
  it('create, invite, accept, decline, withdraw and invite again', async () => {
    const maya = await h.as('maya');
    const created = await maya.post('/api/circles').send({ name: 'Book club', description: 'Novels and snacks', inviteIds: ['sam', 'theo'] });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(created.body.me).toMatchObject({ status: 'active', role: 'organizer' });
    expect(created.body.invited.map((m: any) => m.person.id).sort()).toEqual(['sam', 'theo']);

    // Sam sees the invitation, previews the circle, and joins.
    const sam = await h.as('sam');
    const list = await sam.get('/api/circles');
    expect(list.body.invitations.map((c: any) => c.id)).toContain(id);
    expect((await sam.get('/api/me')).body.attention.circles).toBeGreaterThanOrEqual(1);
    const preview = await sam.get(`/api/circles/${id}`);
    expect(preview.status).toBe(200);
    expect(preview.body.me.status).toBe('invited');
    expect(preview.body.activity).toEqual([]); // invitees get a preview, not the history
    expect((await sam.post(`/api/circles/${id}/join`).send({})).status).toBe(200);
    expect(status(id, 'sam')).toBe('active');

    // Theo declines; Sam (a member) invites Priya, then withdraws it.
    expect((await (await h.as('theo')).post(`/api/circles/${id}/decline`).send({})).status).toBe(200);
    expect(status(id, 'theo')).toBe('declined');
    expect((await sam.post(`/api/circles/${id}/invitations`).send({ userId: 'priya' })).status).toBe(200);
    expect((await sam.post(`/api/circles/${id}/invitations`).send({ userId: 'priya' })).body.error.code).toBe('already_invited');
    expect((await sam.post(`/api/circles/${id}/invitations/priya/withdraw`).send({})).status).toBe(200);
    expect((await (await h.as('priya')).post(`/api/circles/${id}/join`).send({})).body.error.code).toBe('no_invitation');

    // Declined people can be invited again.
    expect((await maya.post(`/api/circles/${id}/invitations`).send({ userId: 'theo' })).status).toBe(200);
    expect(status(id, 'theo')).toBe('invited');

    const types = (await maya.get(`/api/circles/${id}`)).body.activity.map((e: any) => e.type).reverse();
    expect(types).toEqual(['created', 'invited', 'invited', 'joined', 'declined', 'invited', 'invite_withdrawn', 'invited']);
  });

  it('keeps circles private and checks every role on the server', async () => {
    const riverside = circleId('Riverside Makers');
    const theo = await h.as('theo'); // left Riverside in the seed story
    const sam = await h.as('sam'); // a member, not an organizer
    const left = await theo.get(`/api/circles/${riverside}`);
    expect(left.status).toBe(404);
    expect(left.body.error.code).toBe('not_a_member');
    expect((await theo.post(`/api/circles/${riverside}/invitations`).send({ userId: 'theo' })).status).toBe(404);
    expect((await sam.post(`/api/circles/${riverside}/members/priya/remove`).send({})).status).toBe(403);
    expect((await sam.post(`/api/circles/${riverside}/members/priya/organizer`).send({})).status).toBe(403);
    expect((await sam.put(`/api/circles/${riverside}`).send({ name: 'Mine now' })).status).toBe(403);
    // Only an item's owner can put it on a shelf, and only on a circle they're in.
    expect((await sam.post(`/api/circles/${riverside}/items`).send({ itemId: 'item-drill' })).status).toBe(403);
    expect((await theo.post(`/api/circles/${riverside}/items`).send({ itemId: 'item-washer' })).status).toBe(404);
    expect((await sam.get(`/api/circles/${riverside}/members/priya/impact`)).status).toBe(403);
    expect((await (await h.as('priya')).get('/api/circles/nope')).status).toBe(404);
  });

  it('the last organizer hands over before leaving', async () => {
    const riverside = circleId('Riverside Makers');
    const maya = await h.as('maya');
    const leave = await maya.post(`/api/circles/${riverside}/leave`).send({});
    expect(leave.status).toBe(409);
    expect(leave.body.error.code).toBe('last_organizer');
    expect((await maya.post(`/api/circles/${riverside}/members/sam/organizer`).send({})).status).toBe(200);
    expect((await maya.post(`/api/circles/${riverside}/leave`).send({})).status).toBe(200);
    expect(status(riverside, 'maya')).toBe('left');
    const after = await (await h.as('sam')).get(`/api/circles/${riverside}`);
    expect(after.body.members.find((m: any) => m.person.id === 'sam').role).toBe('organizer');
    // Maya's items left the shelf with her.
    expect(after.body.shelf.map((i: any) => i.id)).not.toContain('item-ladder');
  });
});

describe('who can see and ask for circle items', () => {
  it('circle-only items are visible and requestable only by current members', async () => {
    const riverside = circleId('Riverside Makers');
    // Sam (member) sees the circle-only sewing machine; Theo (left) doesn't.
    const samCatalog = (await (await h.as('sam')).get('/api/items')).body.map((i: any) => i.id);
    const theoCatalog = (await (await h.as('theo')).get('/api/items')).body.map((i: any) => i.id);
    expect(samCatalog).toContain('item-sewing');
    expect(theoCatalog).not.toContain('item-sewing');
    // Open items shared with a circle stay in everyone's catalog.
    expect(theoCatalog).toContain('item-ladder');

    const sewing = (await (await h.as('sam')).get('/api/items/item-sewing')).body;
    expect(sewing.audience).toBe('circles');
    expect(sewing.viaCircle.name).toBe('Riverside Makers');
    expect(sewing.circles.map((c: any) => c.id)).toEqual([riverside]);

    const hidden = await (await h.as('theo')).get('/api/items/item-sewing');
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe('item_circle_only');

    const refused = await ask('theo', 'item-sewing', 20, 21);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('circle_only');

    const ok = await ask('sam', 'item-sewing', 20, 21);
    expect(ok.status).toBe(201);
    expect(ok.body.via).toMatchObject({ name: 'Riverside Makers', borrowerStillMember: true });

    // The circle filter only works for members, and circle names don't leak.
    expect((await (await h.as('sam')).get(`/api/items?circle=${riverside}`)).body.map((i: any) => i.id)).toContain('item-sewing');
    expect((await (await h.as('theo')).get(`/api/items?circle=${riverside}`)).body).toEqual([]);
    const ladderForTheo = (await (await h.as('theo')).get('/api/items/item-ladder')).body;
    expect(ladderForTheo.circles).toEqual([]);
  });

  it('owners choose the audience; circles-only needs at least one circle', async () => {
    const maya = await h.as('maya');
    const riverside = circleId('Riverside Makers');
    const base = { title: 'Pasta maker', category: 'Kitchen', maxDays: 5 };
    const bad = await maya.post('/api/items').send({ ...base, audience: 'circles', circleIds: [] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields.circleIds).toBeTruthy();
    const harbour = circleId('Harbour Lane Street Party');
    expect((await maya.post('/api/items').send({ ...base, audience: 'circles', circleIds: [harbour] })).status).toBe(403);

    const made = await maya.post('/api/items').send({ ...base, audience: 'circles', circleIds: [riverside] });
    expect(made.status).toBe(201);
    expect(made.body.audience).toBe('circles');
    expect((await (await h.as('theo')).get(`/api/items/${made.body.id}`)).status).toBe(404);

    // Editing without sharing fields keeps the current sharing.
    const edited = await maya.put(`/api/items/${made.body.id}`).send({ ...base, title: 'Pasta maker (manual)' });
    expect(edited.body.audience).toBe('circles');
    expect(edited.body.circles).toHaveLength(1);
    const opened = await maya.put(`/api/items/${made.body.id}`).send({ ...base, audience: 'everyone', circleIds: [] });
    expect(opened.body).toMatchObject({ audience: 'everyone', circles: [] });
    expect((await (await h.as('theo')).get(`/api/items/${made.body.id}`)).status).toBe(200);
  });

  it('limiting an item to circles leaves requests already made in the owner’s hands', async () => {
    // Theo (not in Riverside) has a pending request for Maya's open stand mixer.
    const theoReq = h.db.prepare(`SELECT id FROM loans WHERE item_id = 'item-mixer' AND borrower_id = 'theo'`).get() as any;
    const maya = await h.as('maya');
    const riverside = circleId('Riverside Makers');
    await maya.post(`/api/circles/${riverside}/items`).send({ itemId: 'item-mixer', audience: 'circles' });
    expect((await ask('theo', 'item-mixer', 20, 21)).status).toBe(403); // nothing new
    const theo = await h.as('theo');
    expect((await theo.get('/api/items/item-mixer')).status).toBe(200); // involved, so still visible
    const approved = await maya.post(`/api/loans/${theoReq.id}/approve`).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
  });
});

describe('membership changes never invalidate commitments', () => {
  it('removing a member stops new circle-only requests but keeps their requests, reservations and loans', async () => {
    const riverside = circleId('Riverside Makers');
    const maya = await h.as('maya');
    const priya = await h.as('priya');

    // Priya has an approved reservation (seed) and now also a pending request, both via the circle.
    const reservation = (h.db.prepare(`SELECT id FROM loans WHERE item_id = 'item-sewing' AND borrower_id = 'priya' AND status = 'approved'`).get() as any).id;
    const pending = (await ask('priya', 'item-sewing', 30, 31)).body.id;

    // The organizer sees exactly what will and won't change.
    const impact = (await maya.get(`/api/circles/${riverside}/members/priya/impact`)).body;
    expect(impact.borrowing.map((b: any) => [b.loanId, b.commitment])).toEqual([[reservation, true], [pending, false]]);
    expect(impact.items).toEqual([{ id: 'item-games', title: 'Board game night box', becomesUnshared: true }]);

    const removed = await maya.post(`/api/circles/${riverside}/members/priya/remove`).send({});
    expect(removed.status).toBe(200);
    expect(status(riverside, 'priya')).toBe('removed');

    // Nothing she already had changed.
    const loan = (await priya.get(`/api/loans/${reservation}`)).body;
    expect(loan.status).toBe('approved');
    expect(loan.via).toMatchObject({ name: 'Riverside Makers', borrowerStillMember: false, borrowerLeft: { how: 'removed' } });
    expect((await priya.get(`/api/loans/${pending}`)).body.status).toBe('requested');

    // But she can't ask for anything new that's circle-only.
    const refused = await ask('priya', 'item-sewing', 40, 41);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('circle_only');
    const item = (await priya.get('/api/items/item-sewing')).body; // still visible: she has a booking
    expect(item.canRequest.ok).toBe(false);
    expect(item.myOpenLoans.map((l: any) => l.id).sort()).toEqual([pending, reservation].sort());

    // The reservation runs its full course, including an extension.
    expect((await maya.post(`/api/loans/${reservation}/ready`).send({})).status).toBe(200);
    setClock(() => new Date(`${d(6)}T16:00:00Z`));
    expect((await priya.post(`/api/loans/${reservation}/pickup`).send({})).status).toBe(200);
    expect((await priya.post(`/api/loans/${reservation}/extensions`).send({ endDate: d(11) })).status).toBe(200);
    const ext = (await maya.get(`/api/loans/${reservation}`)).body.pendingExtension.id;
    expect((await maya.post(`/api/extensions/${ext}/accept`).send({})).status).toBe(200);
    expect((await priya.post(`/api/loans/${reservation}/return`).send({ report: { condition: 'good', notes: 'Thanks!', photoIds: [] } })).status).toBe(200);
    expect((await maya.post(`/api/loans/${reservation}/confirm-return`).send({ report: { condition: 'good', notes: '', photoIds: [] } })).body.status).toBe('returned');

    // The owner still decides on the pending request, with context.
    const ownerView = (await maya.get(`/api/loans/${pending}`)).body;
    expect(ownerView.via.borrowerStillMember).toBe(false);
    expect((await maya.post(`/api/loans/${pending}/approve`).send({})).status).toBe(200);

    // Her own circle-only items left the shelf and are now shared with nobody.
    expect((await (await h.as('sam')).get('/api/items/item-games')).status).toBe(404);
    expect((await priya.get('/api/items/item-games')).body.circles).toEqual([]);
  });

  it('the seeded member who left keeps their booking and can see it through', async () => {
    const theo = await h.as('theo');
    const priya = await h.as('priya');
    const booking = (h.db.prepare(`SELECT id FROM loans WHERE item_id = 'item-games' AND borrower_id = 'theo'`).get() as any).id;
    const view = (await theo.get(`/api/loans/${booking}`)).body;
    expect(view.status).toBe('approved');
    expect(view.via).toMatchObject({ name: 'Riverside Makers', borrowerStillMember: false, borrowerLeft: { how: 'left' } });
    expect((await priya.post(`/api/loans/${booking}/ready`).send({})).status).toBe(200);
    expect((await theo.get('/api/items/item-games')).status).toBe(200);
  });

  it('rejoining restores access', async () => {
    const riverside = circleId('Riverside Makers');
    expect((await ask('theo', 'item-sewing', 20, 21)).status).toBe(403);
    await (await h.as('maya')).post(`/api/circles/${riverside}/invitations`).send({ userId: 'theo' });
    await (await h.as('theo')).post(`/api/circles/${riverside}/join`).send({});
    expect((await ask('theo', 'item-sewing', 20, 21)).status).toBe(201);
  });
});

describe('database guards', () => {
  const insertLoan = (id: string, item: string, borrower: string, owner: string, via: string | null) =>
    h.db.prepare(
      `INSERT INTO loans (id, item_id, borrower_id, owner_id, status, start_date, end_date, original_end_date, via_circle_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?)`,
    ).run(id, item, borrower, owner, d(40), d(41), d(41), via, FIXED_NOW, FIXED_NOW);

  it('refuses a circle-only loan for a non-member, and never lets a loan’s origin change', () => {
    const riverside = circleId('Riverside Makers');
    expect(() => insertLoan('x1', 'item-sewing', 'theo', 'maya', null)).toThrow(/CIRCLE_ONLY/);
    expect(() => insertLoan('x2', 'item-sewing', 'theo', 'maya', riverside)).toThrow(/CIRCLE_ONLY/);
    insertLoan('x3', 'item-sewing', 'sam', 'maya', riverside);
    expect(() => h.db.prepare(`UPDATE loans SET via_circle_id = NULL WHERE id = 'x3'`).run()).toThrow(/IMMUTABLE_FIELD/);
  });

  it('refuses shelf items from non-members, illegal membership changes and history edits', () => {
    const riverside = circleId('Riverside Makers');
    expect(() => h.db.prepare(`INSERT INTO item_circles (item_id, circle_id, added_at) VALUES ('item-washer', ?, ?)`).run(riverside, FIXED_NOW)).toThrow(/NOT_A_MEMBER/);
    expect(() => h.db.prepare(`UPDATE circle_members SET status = 'active' WHERE circle_id = ? AND user_id = 'theo'`).run(riverside)).toThrow(/ILLEGAL_TRANSITION/);
    expect(() => h.db.prepare(`UPDATE circle_events SET type = 'x'`).run()).toThrow(/APPEND_ONLY/);
    expect(() => h.db.prepare(`DELETE FROM circle_events`).run()).toThrow(/APPEND_ONLY/);
  });
});

describe('races between removal and requests', () => {
  const worker = join(import.meta.dirname, 'helpers', 'circle-worker.ts');
  const run = (args: string[]) =>
    new Promise<any>((resolve, reject) => {
      const child = spawn(process.execPath, [worker, h.dbFile, ...args]);
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

  it('separate processes: every request lands wholly before or after the removal, and nothing is lost', async () => {
    const riverside = circleId('Riverside Makers');
    // Requests fire 0–600 ms apart; the removal fires in the middle, so some
    // land before it, some after, and the ones near it genuinely race.
    const t0 = Date.now() + 2500;
    const ranges = [[12, 13], [15, 16], [18, 19], [21, 22], [24, 25]];
    const results = await Promise.all([
      run(['remove', 'maya', riverside, 'priya', '', String(t0 + 300), FIXED_NOW]),
      ...ranges.map(([s, e], i) => run(['request', 'priya', 'item-sewing', d(s), d(e), String(t0 + i * 150), FIXED_NOW])),
    ]);
    expect(results[0]).toEqual({ ok: true, kind: 'remove' });
    const requests = results.slice(1);
    // Each request either got in (before the removal) or was refused as circle-only — no other failure.
    for (const r of requests) expect(r.ok || r.code === 'circle_only').toBe(true);
    expect(requests[0].ok).toBe(true); // well before the removal
    expect(requests[4].ok).toBe(false); // well after it

    // Every request that got in is still there, untouched, after the removal.
    const kept = h.db.prepare(
      `SELECT status FROM loans WHERE item_id = 'item-sewing' AND borrower_id = 'priya' AND start_date >= ?`,
    ).all(d(12)) as any[];
    expect(kept.length).toBe(requests.filter((r) => r.ok).length);
    expect(kept.every((l) => l.status === 'requested')).toBe(true);
    // And nothing new gets in afterwards.
    expect(() => L.requestLoan(h.db, 'priya', { itemId: 'item-sewing', startDate: d(30), endDate: d(31) })).toThrow();
  });
});

describe('upgrading a V1 database', () => {
  it('migrates in place: data kept, items open to everyone, old loans carry on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'borrowbox-v1-'));
    const file = join(dir, 'borrowbox.db');
    const v1 = new DatabaseSync(file);
    v1.exec(readFileSync(join(import.meta.dirname, '..', 'server', 'schema.sql'), 'utf8'));
    v1.exec(`INSERT INTO users (id, name, first_name, neighbourhood, created_at) VALUES
               ('a', 'Ann A', 'Ann', 'X', '${FIXED_NOW}'), ('b', 'Ben B', 'Ben', 'X', '${FIXED_NOW}');
             INSERT INTO items (id, owner_id, title, category, max_days, created_at, updated_at)
               VALUES ('i', 'a', 'Old ladder', 'Tools', 5, '${FIXED_NOW}', '${FIXED_NOW}');
             INSERT INTO loans (id, item_id, borrower_id, owner_id, status, start_date, end_date, original_end_date, created_at, updated_at)
               VALUES ('l', 'i', 'b', 'a', 'requested', '${d(2)}', '${d(3)}', '${d(3)}', '${FIXED_NOW}', '${FIXED_NOW}');`);
    v1.close();

    const db = openDatabase(file);
    expect((db.prepare('PRAGMA user_version').get() as any).user_version).toBe(SCHEMA_VERSION);
    expect((db.prepare(`SELECT audience FROM items WHERE id = 'i'`).get() as any).audience).toBe('everyone');
    expect((db.prepare(`SELECT via_circle_id FROM loans WHERE id = 'l'`).get() as any).via_circle_id).toBeNull();
    expect(L.approve(db, 'a', 'l', {}).status).toBe('approved');
    db.close();
    // Opening again is a no-op.
    const again = openDatabase(file);
    expect((again.prepare(`SELECT count(*) n FROM loans`).get() as any).n).toBe(1);
    again.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
