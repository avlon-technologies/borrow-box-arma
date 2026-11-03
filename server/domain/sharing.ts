/**
 * Who can see and ask for an item — the one place these rules live.
 *
 *   audience 'everyone'  anyone can see and ask (V1 behaviour)
 *   audience 'circles'   only active members of a circle the item is shared with
 *
 * Access is checked when someone asks to borrow. Existing loans are governed by
 * the owner and borrower alone, so they never depend on these rules (see
 * docs/adr/0001-lending-circles.md).
 */
import { type DB, one, all, run } from '../db.ts';
import { nowIso } from '../dates.ts';
import { forbidden, invalid } from './errors.ts';

export type Audience = 'everyone' | 'circles';

export interface CircleTag {
  id: string;
  name: string;
  hue: number;
}

export const toTag = (row: any): CircleTag => ({ id: row.id, name: row.name, hue: row.hue });

export function membership(db: DB, circleId: string, userId: string) {
  return one<any>(db, `SELECT * FROM circle_members WHERE circle_id = ? AND user_id = ?`, circleId, userId);
}

export function isActiveMember(db: DB, circleId: string, userId: string): boolean {
  return membership(db, circleId, userId)?.status === 'active';
}

/** SQL condition: item `i` can be seen by the person bound to the two `?`s (pass viewerId twice). */
export const VISIBLE_TO_SQL = `(i.owner_id = ? OR i.audience = 'everyone' OR EXISTS (
  SELECT 1 FROM item_circles ic JOIN circle_members m ON m.circle_id = ic.circle_id
   WHERE ic.item_id = i.id AND m.user_id = ? AND m.status = 'active'))`;

/** Circles an item is shared with that `userId` is an active member of, by name. */
function sharedCirclesWith(db: DB, itemId: string, userId: string): CircleTag[] {
  return all(
    db,
    `SELECT c.id, c.name, c.hue FROM item_circles ic
       JOIN circles c ON c.id = ic.circle_id
       JOIN circle_members m ON m.circle_id = ic.circle_id AND m.user_id = ? AND m.status = 'active'
      WHERE ic.item_id = ? ORDER BY c.name`,
    userId, itemId,
  ).map(toTag);
}

/**
 * Circles shown on an item for this viewer. The owner sees all of them;
 * anyone else only sees circles they belong to (circle names stay private).
 */
export function itemCirclesFor(db: DB, viewerId: string, item: { id: string; owner_id: string }): CircleTag[] {
  if (item.owner_id === viewerId) {
    return all(
      db,
      `SELECT c.id, c.name, c.hue FROM item_circles ic JOIN circles c ON c.id = ic.circle_id
        WHERE ic.item_id = ? ORDER BY c.name`,
      item.id,
    ).map(toTag);
  }
  return sharedCirclesWith(db, item.id, viewerId);
}

export type Access =
  | { ok: true; via: CircleTag | null }
  | { ok: false; reason: string };

/** May `userId` ask to borrow this item right now (ignoring hidden/ownership, checked elsewhere)? */
export function borrowAccess(db: DB, userId: string, item: { id: string; audience: Audience }): Access {
  if (item.audience !== 'circles') return { ok: true, via: null };
  const via = sharedCirclesWith(db, item.id, userId)[0];
  if (via) return { ok: true, via };
  return { ok: false, reason: 'This is shared only with members of a circle you’re not part of right now.' };
}

/** Has this person ever had a loan (any status) on the item? */
export function isInvolved(db: DB, userId: string, itemId: string): boolean {
  return !!one(db, `SELECT 1 FROM loans WHERE item_id = ? AND borrower_id = ? LIMIT 1`, itemId, userId);
}

export function logCircleEvent(
  db: DB,
  circleId: string,
  actorId: string | null,
  type: string,
  subjectId: string | null = null,
  detail: Record<string, unknown> = {},
) {
  run(
    db,
    `INSERT INTO circle_events (circle_id, actor_id, subject_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    circleId, actorId, subjectId, type, JSON.stringify(detail), nowIso(),
  );
}

export function shareWithCircle(db: DB, actorId: string, item: { id: string; title: string }, circleId: string) {
  if (one(db, `SELECT 1 FROM item_circles WHERE item_id = ? AND circle_id = ?`, item.id, circleId)) return false;
  if (!isActiveMember(db, circleId, actorId)) throw forbidden('You can only share things with circles you belong to.');
  run(db, `INSERT INTO item_circles (item_id, circle_id, added_at) VALUES (?, ?, ?)`, item.id, circleId, nowIso());
  logCircleEvent(db, circleId, actorId, 'item_shared', null, { itemId: item.id, title: item.title });
  return true;
}

export function unshareFromCircle(db: DB, actorId: string | null, item: { id: string; title: string }, circleId: string, reason?: string) {
  const res = run(db, `DELETE FROM item_circles WHERE item_id = ? AND circle_id = ?`, item.id, circleId);
  if (!res.changes) return false;
  logCircleEvent(db, circleId, actorId, 'item_unshared', null, { itemId: item.id, title: item.title, ...(reason ? { reason } : {}) });
  return true;
}

/**
 * Apply an owner's sharing choices. `circleIds` (if given) is the full set of
 * circles the item should be on; `audience` (if given) who may ask for it.
 * Must run inside a transaction. Existing loans are never touched.
 */
export function applySharing(
  db: DB,
  actorId: string,
  item: { id: string; title: string },
  choice: { audience?: Audience; circleIds?: string[] },
) {
  if (choice.circleIds) {
    const wanted = new Set(choice.circleIds);
    const current = all(db, `SELECT circle_id FROM item_circles WHERE item_id = ?`, item.id).map((r) => r.circle_id as string);
    for (const id of current) if (!wanted.has(id)) unshareFromCircle(db, actorId, item, id);
    for (const id of wanted) {
      if (!one(db, `SELECT 1 FROM circles WHERE id = ?`, id)) throw invalid('One of those circles couldn’t be found.');
      shareWithCircle(db, actorId, item, id);
    }
  }
  if (choice.audience) {
    if (choice.audience === 'circles') {
      const n = (one<any>(db, `SELECT count(*) n FROM item_circles WHERE item_id = ?`, item.id)?.n ?? 0) as number;
      if (n === 0)
        throw invalid('Choose at least one circle to keep it within — or open it to everyone.', {
          fields: { circleIds: 'Choose at least one circle.' },
        });
    }
    run(db, `UPDATE items SET audience = ?, updated_at = ? WHERE id = ?`, choice.audience, nowIso(), item.id);
  }
}
