/**
 * Lending circles: small groups of friends who share a shelf.
 *
 * Membership lifecycle (one row per person per circle, history in circle_events):
 *
 *   invited ──accept──▶ active ──leave──▶ left
 *     │                   └──remove (organizer)──▶ removed
 *     ├─decline─▶ declined
 *     └─withdraw (inviter/organizer)─▶ withdrawn
 *   declined / withdrawn / left / removed ──invite again──▶ invited
 *
 * Ending a membership takes that person's items off the circle's shelf and
 * stops them asking for circle-only items. It never touches loans already
 * made — those belong to the owner and borrower (docs/adr/0001-lending-circles.md).
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type DB, one, all, run, transaction } from '../db.ts';
import { nowIso } from '../dates.ts';
import { HOLDING_STATUSES, OPEN_STATUSES } from '../../shared/constants.ts';
import { AppError, conflict, forbidden, fromDbError, invalid, notFound } from './errors.ts';
import { publicUser } from './users.ts';
import { listCatalog, loadItem, parse, summarizeItem } from './items.ts';
import { type CircleTag, logCircleEvent, membership, shareWithCircle, toTag, unshareFromCircle } from './sharing.ts';

const open = OPEN_STATUSES.map((s) => `'${s}'`).join(',');
const holding = HOLDING_STATUSES.map((s) => `'${s}'`).join(',');

export const CIRCLE_HUES = [18, 42, 95, 150, 190, 220, 265, 330] as const;

const circleInput = z.object({
  name: z.string().trim().min(2, 'Give your circle a name of at least 2 characters.').max(60, 'Keep the name under 60 characters.'),
  description: z.string().trim().max(400, 'Keep it under 400 characters.').default(''),
  hue: z.coerce.number().int().min(0).max(359).default(CIRCLE_HUES[0]),
});
const createInput = circleInput.extend({
  inviteIds: z.array(z.string().min(1)).max(50).default([]),
});
const userRef = z.object({ userId: z.string().min(1, 'Choose someone to invite.') });
const contributeInput = z.object({
  itemId: z.string().min(1, 'Choose one of your items.'),
  /** If given, also set who can ask for the item. */
  audience: z.enum(['everyone', 'circles']).optional(),
});

// ---------------------------------------------------------------- helpers

function mutate<T>(db: DB, fn: () => T): T {
  try {
    return transaction(db, fn);
  } catch (err) {
    throw fromDbError(err);
  }
}

function loadCircle(db: DB, id: string) {
  const row = one<any>(db, `SELECT * FROM circles WHERE id = ?`, id);
  if (!row) throw notFound('That circle');
  return row;
}

/** The actor must be an active member (optionally an organizer). Non-members get a 404. */
function requireMember(db: DB, circleId: string, userId: string, organizer = false) {
  loadCircle(db, circleId);
  const m = membership(db, circleId, userId);
  if (m?.status !== 'active') {
    if (m && (m.status === 'left' || m.status === 'removed'))
      throw new AppError(404, 'not_a_member', 'You’re not part of this circle any more.');
    throw notFound('That circle');
  }
  if (organizer && m.role !== 'organizer') throw forbidden('Only the circle’s organizers can do that.');
  return m;
}

function setStatus(db: DB, circleId: string, userId: string, status: string, extra: Record<string, unknown> = {}) {
  const fields = { status, since: nowIso(), ...extra };
  const keys = Object.keys(fields);
  run(
    db,
    `UPDATE circle_members SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE circle_id = ? AND user_id = ?`,
    ...keys.map((k) => (fields as any)[k]), circleId, userId,
  );
}

function activeCount(db: DB, circleId: string, role?: 'organizer') {
  return (one<any>(
    db,
    `SELECT count(*) n FROM circle_members WHERE circle_id = ? AND status = 'active' ${role ? `AND role = 'organizer'` : ''}`,
    circleId,
  )?.n ?? 0) as number;
}

/** Take a departing member's items off the shelf, with a record of each. */
function withdrawItemsOf(db: DB, circleId: string, userId: string, reason: string) {
  const items = all(
    db,
    `SELECT i.id, i.title FROM item_circles ic JOIN items i ON i.id = ic.item_id
      WHERE ic.circle_id = ? AND i.owner_id = ?`,
    circleId, userId,
  );
  for (const item of items) unshareFromCircle(db, null, { id: item.id, title: item.title }, circleId, reason);
}

function invitePerson(db: DB, actorId: string, circleId: string, userId: string) {
  if (userId === actorId) throw invalid('You’re already in this circle.');
  if (!one(db, `SELECT 1 FROM users WHERE id = ?`, userId)) throw invalid('That person couldn’t be found.');
  const existing = membership(db, circleId, userId);
  const name = publicUser(db, userId).firstName;
  if (existing?.status === 'active') throw conflict('already_member', `${name} is already in this circle.`);
  if (existing?.status === 'invited') throw conflict('already_invited', `${name} has already been invited.`);
  const at = nowIso();
  if (existing) setStatus(db, circleId, userId, 'invited', { role: 'member', invited_by: actorId });
  else
    run(
      db,
      `INSERT INTO circle_members (circle_id, user_id, status, role, invited_by, since) VALUES (?, ?, 'invited', 'member', ?, ?)`,
      circleId, userId, actorId, at,
    );
  logCircleEvent(db, circleId, actorId, 'invited', userId);
}

// ---------------------------------------------------------------- circle

export function createCircle(db: DB, actorId: string, input: unknown) {
  const data = parse(createInput, input);
  const id = randomUUID();
  mutate(db, () => {
    const at = nowIso();
    run(
      db,
      `INSERT INTO circles (id, name, description, hue, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, data.name, data.description, data.hue, actorId, at, at,
    );
    run(
      db,
      `INSERT INTO circle_members (circle_id, user_id, status, role, invited_by, since) VALUES (?, ?, 'active', 'organizer', NULL, ?)`,
      id, actorId, at,
    );
    logCircleEvent(db, id, actorId, 'created', actorId, { name: data.name });
    for (const userId of new Set(data.inviteIds)) if (userId !== actorId) invitePerson(db, actorId, id, userId);
  });
  return getCircle(db, actorId, id);
}

export function updateCircle(db: DB, actorId: string, circleId: string, input: unknown) {
  const data = parse(circleInput, input);
  mutate(db, () => {
    requireMember(db, circleId, actorId, true);
    const before = loadCircle(db, circleId);
    run(
      db,
      `UPDATE circles SET name = ?, description = ?, hue = ?, updated_at = ? WHERE id = ?`,
      data.name, data.description, data.hue, nowIso(), circleId,
    );
    if (before.name !== data.name) logCircleEvent(db, circleId, actorId, 'renamed', null, { from: before.name, to: data.name });
  });
  return getCircle(db, actorId, circleId);
}

// ---------------------------------------------------------------- membership

/** Any member can invite a friend — circles are built on trust. */
export function invite(db: DB, actorId: string, circleId: string, input: unknown) {
  const { userId } = parse(userRef, input);
  mutate(db, () => {
    requireMember(db, circleId, actorId);
    invitePerson(db, actorId, circleId, userId);
  });
  return getCircle(db, actorId, circleId);
}

/** The person who sent an invitation, or an organizer, can take it back. */
export function withdrawInvite(db: DB, actorId: string, circleId: string, userId: string) {
  mutate(db, () => {
    const me = requireMember(db, circleId, actorId);
    const m = membership(db, circleId, userId);
    if (m?.status !== 'invited') throw conflict('illegal_transition', 'That invitation has already been answered.');
    if (m.invited_by !== actorId && me.role !== 'organizer')
      throw forbidden('Only the person who sent the invitation, or an organizer, can withdraw it.');
    setStatus(db, circleId, userId, 'withdrawn');
    logCircleEvent(db, circleId, actorId, 'invite_withdrawn', userId);
  });
  return getCircle(db, actorId, circleId);
}

export function respondToInvite(db: DB, actorId: string, circleId: string, accept: boolean) {
  mutate(db, () => {
    loadCircle(db, circleId);
    const m = membership(db, circleId, actorId);
    if (m?.status === 'active') throw conflict('already_member', 'You’re already in this circle.');
    if (m?.status !== 'invited')
      throw conflict('no_invitation', 'This invitation isn’t open any more — it may have been withdrawn.');
    setStatus(db, circleId, actorId, accept ? 'active' : 'declined');
    logCircleEvent(db, circleId, actorId, accept ? 'joined' : 'declined', actorId);
  });
  return accept ? getCircle(db, actorId, circleId) : { ok: true };
}

export function leave(db: DB, actorId: string, circleId: string) {
  mutate(db, () => {
    const me = requireMember(db, circleId, actorId);
    if (me.role === 'organizer' && activeCount(db, circleId, 'organizer') === 1 && activeCount(db, circleId) > 1)
      throw conflict(
        'last_organizer',
        'You’re the only organizer. Make someone else an organizer first, so the circle is looked after.',
      );
    withdrawItemsOf(db, circleId, actorId, 'left');
    setStatus(db, circleId, actorId, 'left');
    logCircleEvent(db, circleId, actorId, 'left', actorId);
  });
  return { ok: true };
}

/**
 * An organizer removes someone. From now on they can't ask for this circle's
 * circle-only items and their items leave the shelf. Requests, reservations
 * and loans they already have carry on unchanged.
 */
export function removeMember(db: DB, actorId: string, circleId: string, userId: string) {
  mutate(db, () => {
    requireMember(db, circleId, actorId, true);
    if (userId === actorId) throw invalid('To step away yourself, leave the circle instead.');
    const m = membership(db, circleId, userId);
    if (m?.status !== 'active') throw conflict('illegal_transition', 'They’re not a member of this circle right now.');
    withdrawItemsOf(db, circleId, userId, 'removed');
    setStatus(db, circleId, userId, 'removed', { role: 'member' });
    logCircleEvent(db, circleId, actorId, 'removed', userId);
  });
  return getCircle(db, actorId, circleId);
}

export function makeOrganizer(db: DB, actorId: string, circleId: string, userId: string) {
  mutate(db, () => {
    requireMember(db, circleId, actorId, true);
    const m = membership(db, circleId, userId);
    if (m?.status !== 'active') throw conflict('illegal_transition', 'They’re not a member of this circle right now.');
    if (m.role === 'organizer') return;
    run(db, `UPDATE circle_members SET role = 'organizer' WHERE circle_id = ? AND user_id = ?`, circleId, userId);
    logCircleEvent(db, circleId, actorId, 'organizer_added', userId);
  });
  return getCircle(db, actorId, circleId);
}

// ---------------------------------------------------------------- shelf

export function contribute(db: DB, actorId: string, circleId: string, input: unknown) {
  const data = parse(contributeInput, input);
  mutate(db, () => {
    requireMember(db, circleId, actorId);
    const item = loadItem(db, data.itemId);
    if (item.owner_id !== actorId) throw forbidden('You can only share your own things.');
    shareWithCircle(db, actorId, item, circleId);
    if (data.audience) run(db, `UPDATE items SET audience = ?, updated_at = ? WHERE id = ?`, data.audience, nowIso(), item.id);
  });
  return getCircle(db, actorId, circleId);
}

/**
 * The owner takes an item off this circle's shelf. If it was circle-only and
 * this was its last circle, nobody new can ask for it until it's shared again
 * (existing bookings are untouched) — the owner is shown that.
 */
export function withdrawItem(db: DB, actorId: string, circleId: string, itemId: string) {
  mutate(db, () => {
    requireMember(db, circleId, actorId);
    const item = loadItem(db, itemId);
    if (item.owner_id !== actorId) throw forbidden('Only the owner can take it off the shelf.');
    unshareFromCircle(db, actorId, item, circleId);
  });
  return getCircle(db, actorId, circleId);
}

// ---------------------------------------------------------------- impact preview

/**
 * What would change if this person stopped being a member? Shown before an
 * organizer removes someone, or before someone leaves, so nobody is surprised.
 */
export function membershipImpact(db: DB, actorId: string, circleId: string, userId: string) {
  requireMember(db, circleId, actorId, actorId !== userId);
  const m = membership(db, circleId, userId);
  if (m?.status !== 'active') throw conflict('illegal_transition', 'They’re not a member of this circle right now.');

  // Commitments they have as a borrower through this circle — these carry on.
  const borrowing = all(
    db,
    `SELECT l.id, l.status, l.start_date, l.end_date, i.title, l.owner_id FROM loans l JOIN items i ON i.id = l.item_id
      WHERE l.borrower_id = ? AND l.via_circle_id = ? AND l.status IN (${open})
      ORDER BY l.start_date`,
    userId, circleId,
  ).map((l) => ({
    loanId: l.id, title: l.title, status: l.status, startDate: l.start_date, endDate: l.end_date,
    owner: publicUser(db, l.owner_id),
    commitment: (HOLDING_STATUSES as string[]).includes(l.status),
  }));

  // Their items other members have through this circle — these carry on too.
  const lending = all(
    db,
    `SELECT l.id, l.status, l.start_date, l.end_date, i.title, l.borrower_id FROM loans l JOIN items i ON i.id = l.item_id
      WHERE l.owner_id = ? AND l.via_circle_id = ? AND l.status IN (${holding})
      ORDER BY l.start_date`,
    userId, circleId,
  ).map((l) => ({
    loanId: l.id, title: l.title, status: l.status, startDate: l.start_date, endDate: l.end_date,
    borrower: publicUser(db, l.borrower_id),
  }));

  // Their items on the shelf, which would leave it.
  const items = all(
    db,
    `SELECT i.id, i.title, i.audience,
            (SELECT count(*) FROM item_circles o WHERE o.item_id = i.id AND o.circle_id <> ?) AS other_circles
       FROM item_circles ic JOIN items i ON i.id = ic.item_id
      WHERE ic.circle_id = ? AND i.owner_id = ? ORDER BY i.title`,
    circleId, circleId, userId,
  ).map((i) => ({
    id: i.id, title: i.title,
    /** Circle-only and not on any other shelf: nobody new could ask for it. */
    becomesUnshared: i.audience === 'circles' && i.other_circles === 0,
  }));

  const lastOrganizer = m.role === 'organizer' && activeCount(db, circleId, 'organizer') === 1 && activeCount(db, circleId) > 1;
  return { person: publicUser(db, userId), borrowing, lending, items, lastOrganizer };
}

// ---------------------------------------------------------------- views

function memberCards(db: DB, circleId: string) {
  const rows = all(
    db,
    `SELECT m.*, (SELECT count(*) FROM item_circles ic JOIN items i ON i.id = ic.item_id
                   WHERE ic.circle_id = m.circle_id AND i.owner_id = m.user_id AND i.hidden = 0) AS items
       FROM circle_members m JOIN users u ON u.id = m.user_id
      WHERE m.circle_id = ? AND m.status IN ('active','invited')
      ORDER BY m.status, m.role = 'organizer' DESC, u.name`,
    circleId,
  );
  return rows.map((m) => ({
    person: publicUser(db, m.user_id),
    status: m.status as 'active' | 'invited',
    role: m.role as 'organizer' | 'member',
    since: m.since,
    invitedBy: m.invited_by ? publicUser(db, m.invited_by) : null,
    items: m.items as number,
  }));
}

function summaryOf(db: DB, row: any, viewerId: string) {
  const members = all(
    db,
    `SELECT user_id FROM circle_members WHERE circle_id = ? AND status = 'active' ORDER BY role = 'organizer' DESC, since`,
    row.id,
  ).map((m) => publicUser(db, m.user_id));
  const items = (one<any>(
    db,
    `SELECT count(*) n FROM item_circles ic JOIN items i ON i.id = ic.item_id WHERE ic.circle_id = ? AND i.hidden = 0`,
    row.id,
  )?.n ?? 0) as number;
  const m = membership(db, row.id, viewerId);
  return {
    ...toTag(row),
    description: row.description,
    createdAt: row.created_at,
    members,
    memberCount: members.length,
    itemCount: items,
    myRole: m?.status === 'active' ? (m.role as 'organizer' | 'member') : null,
  };
}

export function listCircles(db: DB, viewerId: string) {
  const circles = all(
    db,
    `SELECT c.* FROM circles c JOIN circle_members m ON m.circle_id = c.id
      WHERE m.user_id = ? AND m.status = 'active' ORDER BY c.name`,
    viewerId,
  ).map((c) => summaryOf(db, c, viewerId));
  const invitations = all(
    db,
    `SELECT c.*, m.invited_by, m.since AS invited_at FROM circles c JOIN circle_members m ON m.circle_id = c.id
      WHERE m.user_id = ? AND m.status = 'invited' ORDER BY m.since DESC`,
    viewerId,
  ).map((c) => ({
    ...summaryOf(db, c, viewerId),
    invitedBy: c.invited_by ? publicUser(db, c.invited_by) : null,
    invitedAt: c.invited_at,
  }));
  return { circles, invitations };
}

/** Circles this person is an active member of — for sharing pickers and filters. */
export function myCircleTags(db: DB, viewerId: string): CircleTag[] {
  return all(
    db,
    `SELECT c.id, c.name, c.hue FROM circles c JOIN circle_members m ON m.circle_id = c.id
      WHERE m.user_id = ? AND m.status = 'active' ORDER BY c.name`,
    viewerId,
  ).map(toTag);
}

export function pendingInvitations(db: DB, viewerId: string): number {
  return (one<any>(db, `SELECT count(*) n FROM circle_members WHERE user_id = ? AND status = 'invited'`, viewerId)?.n ?? 0) as number;
}

function eventCards(db: DB, circleId: string) {
  return all(db, `SELECT * FROM circle_events WHERE circle_id = ? ORDER BY seq DESC LIMIT 40`, circleId).map((e) => ({
    seq: e.seq,
    type: e.type,
    actor: e.actor_id ? publicUser(db, e.actor_id) : null,
    subject: e.subject_id ? publicUser(db, e.subject_id) : null,
    detail: JSON.parse(e.detail),
    at: e.created_at,
  }));
}

/**
 * A circle's page. Active members see everything; someone with an open
 * invitation sees a preview (who's in it and what's on the shelf) so they can
 * decide whether to join.
 */
export function getCircle(db: DB, viewerId: string, circleId: string) {
  const row = loadCircle(db, circleId);
  const m = membership(db, circleId, viewerId);
  if (m?.status !== 'active' && m?.status !== 'invited') {
    if (m && (m.status === 'left' || m.status === 'removed'))
      throw new AppError(404, 'not_a_member', 'You’re not part of this circle any more.');
    throw notFound('That circle');
  }
  const members = memberCards(db, circleId);
  const shelf = all(
    db,
    `SELECT i.id FROM item_circles ic JOIN items i ON i.id = ic.item_id
      WHERE ic.circle_id = ? AND (i.hidden = 0 OR i.owner_id = ?) ORDER BY ic.added_at DESC`,
    circleId, viewerId,
  ).map((r) => r.id as string);
  // Reuse the catalog's item cards so the shelf looks like the rest of the app.
  const cards = new Map(
    (m.status === 'active' ? listCatalog(db, viewerId, { circle: circleId }) : []).map((c) => [c.id, c]),
  );
  const shelfItems = shelf.map((id) => cards.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
  // The viewer's own hidden items aren't in the catalog; show them to their owner.
  for (const id of shelf) {
    if (!cards.has(id) && m.status === 'active') {
      const own = listOwnItemCard(db, viewerId, id);
      if (own) shelfItems.push(own);
    }
  }

  return {
    ...summaryOf(db, row, viewerId),
    me: {
      status: m.status as 'active' | 'invited',
      role: m.status === 'active' ? (m.role as 'organizer' | 'member') : null,
      invitedBy: m.status === 'invited' && m.invited_by ? publicUser(db, m.invited_by) : null,
    },
    members: members.filter((x) => x.status === 'active'),
    invited: m.status === 'active' ? members.filter((x) => x.status === 'invited') : [],
    shelf: m.status === 'active' ? shelfItems : [],
    /** For an invitation preview: a few titles from the shelf. */
    shelfPreview: m.status === 'invited'
      ? all(db, `SELECT i.title FROM item_circles ic JOIN items i ON i.id = ic.item_id WHERE ic.circle_id = ? AND i.hidden = 0 ORDER BY ic.added_at DESC LIMIT 6`, circleId).map((r) => r.title as string)
      : [],
    activity: m.status === 'active' ? eventCards(db, circleId) : [],
  };
}

function listOwnItemCard(db: DB, ownerId: string, itemId: string) {
  // Hidden items are left out of the catalog query, so build the owner's card directly.
  const item = one<any>(db, `SELECT * FROM items WHERE id = ? AND owner_id = ?`, itemId, ownerId);
  return item ? summarizeItem(db, item, ownerId) : null;
}
