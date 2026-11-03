import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type DB, one, all, run, transaction } from '../db.ts';
import { today, nowIso } from '../dates.ts';
import { CATEGORIES, HOLDING_STATUSES, LIMITS, OPEN_STATUSES } from '../../shared/constants.ts';
import { AppError, forbidden, invalid, notFound } from './errors.ts';
import { publicUser, type PublicUser } from './users.ts';

const holding = HOLDING_STATUSES.map((s) => `'${s}'`).join(',');
const open = OPEN_STATUSES.map((s) => `'${s}'`).join(',');

export const itemInput = z.object({
  title: z.string().trim().min(2, 'Give it a name of at least 2 characters.').max(LIMITS.titleLength),
  description: z.string().trim().max(LIMITS.descriptionLength).default(''),
  category: z.enum(CATEGORIES, { errorMap: () => ({ message: 'Choose a category.' }) }),
  maxDays: z.coerce.number().int().min(1, 'Allow at least 1 day.').max(60, 'Up to 60 days at a time.'),
  pickupNotes: z.string().trim().max(LIMITS.noteLength).default(''),
  careNotes: z.string().trim().max(LIMITS.noteLength).default(''),
  /** An upload id from POST /api/uploads, or the item's existing image url to keep it. */
  image: z.string().trim().max(300).nullable().optional(),
});
export type ItemInput = z.infer<typeof itemInput>;

export interface Booking {
  loanId: string | null; // only for the owner or the loan's borrower
  startDate: string;
  endDate: string;
  status: string;
  mine: boolean;
  borrower: PublicUser | null; // only for the owner
}

export interface ItemSummary {
  id: string;
  title: string;
  category: string;
  imageUrl: string | null;
  hidden: boolean;
  maxDays: number;
  owner: PublicUser;
  isMine: boolean;
  availability: Availability;
}

export interface Availability {
  /** "available" — free today; "out" — someone has it or it's reserved today. */
  state: 'available' | 'out';
  /** If out: the day it's due back. */
  backOn: string | null;
  /** If out and the loan is late. */
  overdue: boolean;
  /** The borrower has started bringing it back. */
  returning: boolean;
  /** Next reservation starting after today, if any. */
  nextBookedFrom: string | null;
}

function availabilityFor(db: DB, itemId: string): Availability {
  const t = today();
  const bookings = all(
    db,
    `SELECT start_date, end_date, status FROM loans
      WHERE item_id = ? AND status IN (${holding}) ORDER BY start_date`,
    itemId,
  );
  // Someone holds it today if a reservation covers today, or a borrowed loan
  // hasn't come back yet (even if late).
  const current = bookings.find(
    (b) =>
      (b.start_date <= t && t <= b.end_date) ||
      ((b.status === 'borrowed' || b.status === 'returning') && b.end_date < t),
  );
  const next = bookings.find((b) => b.start_date > t && b !== current);
  return {
    state: current ? 'out' : 'available',
    backOn: current ? current.end_date : null,
    overdue: !!current && current.end_date < t,
    returning: current?.status === 'returning',
    nextBookedFrom: next ? next.start_date : null,
  };
}

function summarize(db: DB, row: any, viewerId: string): ItemSummary {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    imageUrl: row.image_url,
    hidden: !!row.hidden,
    maxDays: row.max_days,
    owner: publicUser(db, row.owner_id),
    isMine: row.owner_id === viewerId,
    availability: availabilityFor(db, row.id),
  };
}

export interface CatalogQuery {
  q?: string;
  category?: string;
  availableNow?: boolean;
  owner?: string;
}

export function listCatalog(db: DB, viewerId: string, query: CatalogQuery): ItemSummary[] {
  const where = ['i.hidden = 0'];
  const params: any[] = [];
  if (query.q && query.q.trim()) {
    const terms = query.q.trim().toLowerCase().split(/\s+/).slice(0, 6);
    for (const term of terms) {
      where.push(`(lower(i.title) LIKE ? OR lower(i.description) LIKE ? OR lower(i.category) LIKE ? OR lower(u.name) LIKE ?)`);
      const like = `%${term.replace(/[%_]/g, '')}%`;
      params.push(like, like, like, like);
    }
  }
  if (query.category && (CATEGORIES as readonly string[]).includes(query.category)) {
    where.push('i.category = ?');
    params.push(query.category);
  }
  if (query.owner) {
    where.push('i.owner_id = ?');
    params.push(query.owner);
  }
  const rows = all(
    db,
    `SELECT i.* FROM items i JOIN users u ON u.id = i.owner_id
      WHERE ${where.join(' AND ')}
      ORDER BY i.created_at DESC`,
    ...params,
  );
  let items = rows.map((r) => summarize(db, r, viewerId));
  if (query.availableNow) items = items.filter((i) => i.availability.state === 'available');
  return items;
}

export function listOwnItems(db: DB, ownerId: string): (ItemSummary & { openRequests: number; activeLoan: boolean })[] {
  const rows = all(db, `SELECT * FROM items WHERE owner_id = ? ORDER BY hidden, created_at DESC`, ownerId);
  return rows.map((r) => ({
    ...summarize(db, r, ownerId),
    openRequests: (one<any>(db, `SELECT count(*) n FROM loans WHERE item_id = ? AND status = 'requested'`, r.id)?.n ?? 0) as number,
    activeLoan: !!one(db, `SELECT 1 FROM loans WHERE item_id = ? AND status IN ('borrowed','returning')`, r.id),
  }));
}

export function loadItem(db: DB, id: string) {
  const row = one<any>(db, `SELECT * FROM items WHERE id = ?`, id);
  if (!row) throw notFound('That item');
  return row;
}

export function getItemDetail(db: DB, viewerId: string, id: string) {
  const row = loadItem(db, id);
  const isOwner = row.owner_id === viewerId;
  const involvement = one(
    db,
    `SELECT 1 FROM loans WHERE item_id = ? AND borrower_id = ? LIMIT 1`,
    id,
    viewerId,
  );
  if (row.hidden && !isOwner && !involvement) {
    throw new AppError(404, 'item_resting', 'This item is resting right now — its owner isn’t lending it at the moment.');
  }
  const t = today();
  const bookingRows = all(
    db,
    `SELECT id, borrower_id, start_date, end_date, status FROM loans
      WHERE item_id = ? AND status IN (${holding})
        AND (end_date >= ? OR status IN ('borrowed','returning'))
      ORDER BY start_date`,
    id,
    t,
  );
  const bookings: Booking[] = bookingRows.map((b) => {
    const mine = b.borrower_id === viewerId;
    return {
      loanId: isOwner || mine ? b.id : null,
      startDate: b.start_date,
      endDate: b.end_date,
      status: b.status,
      mine,
      borrower: isOwner ? publicUser(db, b.borrower_id) : null,
    };
  });

  const myOpenLoans = all(
    db,
    `SELECT id, status, start_date, end_date FROM loans
      WHERE item_id = ? AND borrower_id = ? AND status IN (${open})
      ORDER BY start_date`,
    id,
    viewerId,
  ).map((l) => ({ id: l.id, status: l.status, startDate: l.start_date, endDate: l.end_date }));

  const pendingRequests = isOwner
    ? all(
        db,
        `SELECT id, borrower_id, start_date, end_date, note, created_at FROM loans
          WHERE item_id = ? AND status = 'requested' ORDER BY start_date`,
        id,
      ).map((l) => ({
        id: l.id,
        borrower: publicUser(db, l.borrower_id),
        startDate: l.start_date,
        endDate: l.end_date,
        note: l.note,
        createdAt: l.created_at,
      }))
    : [];

  let canRequest: { ok: boolean; reason?: string } = { ok: true };
  if (isOwner) canRequest = { ok: false, reason: 'This is your item.' };
  else if (row.hidden) canRequest = { ok: false, reason: 'The owner has paused lending this item for now.' };

  return {
    ...summarize(db, row, viewerId),
    description: row.description,
    pickupNotes: row.pickup_notes,
    careNotes: row.care_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    bookings,
    myOpenLoans,
    pendingRequests,
    canRequest,
  };
}

/** Resolve the image field of an item form into a stored URL. */
function resolveImage(db: DB, actorId: string, image: string | null | undefined, current: string | null): string | null {
  if (image === undefined) return current;
  if (image === null || image === '') return null;
  if (image === current) return current;
  const upload = one<any>(db, `SELECT * FROM uploads WHERE id = ?`, image);
  if (!upload) throw invalid('That photo couldn’t be found. Please upload it again.');
  if (upload.uploader_id !== actorId) throw forbidden('You can only use photos you uploaded.');
  return `/uploads/${upload.file_name}`;
}

export function createItem(db: DB, actorId: string, input: unknown) {
  const data = parse(itemInput, input);
  const id = randomUUID();
  const at = nowIso();
  transaction(db, () => {
    const imageUrl = resolveImage(db, actorId, data.image, null);
    run(
      db,
      `INSERT INTO items (id, owner_id, title, description, category, image_url, max_days, pickup_notes, care_notes, hidden, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id, actorId, data.title, data.description, data.category, imageUrl, data.maxDays, data.pickupNotes, data.careNotes, at, at,
    );
  });
  return getItemDetail(db, actorId, id);
}

export function updateItem(db: DB, actorId: string, id: string, input: unknown) {
  const data = parse(itemInput, input);
  transaction(db, () => {
    const row = loadItem(db, id);
    if (row.owner_id !== actorId) throw forbidden('Only the owner can edit this item.');
    const imageUrl = resolveImage(db, actorId, data.image, row.image_url);
    run(
      db,
      `UPDATE items SET title = ?, description = ?, category = ?, image_url = ?, max_days = ?, pickup_notes = ?, care_notes = ?, updated_at = ?
        WHERE id = ?`,
      data.title, data.description, data.category, imageUrl, data.maxDays, data.pickupNotes, data.careNotes, nowIso(), id,
    );
  });
  return getItemDetail(db, actorId, id);
}

/** Hiding stops new requests; it never touches existing reservations or loans. */
export function setHidden(db: DB, actorId: string, id: string, hidden: unknown) {
  if (typeof hidden !== 'boolean') throw invalid('Say whether the item should be hidden.');
  transaction(db, () => {
    const row = loadItem(db, id);
    if (row.owner_id !== actorId) throw forbidden('Only the owner can hide or show this item.');
    run(db, `UPDATE items SET hidden = ?, updated_at = ? WHERE id = ?`, hidden ? 1 : 0, nowIso(), id);
  });
  return getItemDetail(db, actorId, id);
}

export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = Object.values(fields)[0] ?? 'Please check the form.';
    throw invalid(first, { fields });
  }
  return result.data;
}
