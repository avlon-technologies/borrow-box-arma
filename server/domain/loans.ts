import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type DB, one, all, run, transaction } from '../db.ts';
import { addDays, diffDays, isValidDay, nowIso, rangeLength, today } from '../dates.ts';
import { CONDITIONS, HOLDING_STATUSES, LIMITS, OPEN_STATUSES, type LoanStatus } from '../../shared/constants.ts';
import { AppError, conflict, forbidden, fromDbError, invalid, notFound } from './errors.ts';
import { loadItem, parse } from './items.ts';
import { publicUser } from './users.ts';

const holding = HOLDING_STATUSES.map((s) => `'${s}'`).join(',');
const open = OPEN_STATUSES.map((s) => `'${s}'`).join(',');

// ---------------------------------------------------------------- inputs

const day = z.string().refine(isValidDay, 'Choose a valid date.');
const note = z.string().trim().max(LIMITS.noteLength, `Keep it under ${LIMITS.noteLength} characters.`).default('');

export const requestInput = z.object({
  itemId: z.string().min(1),
  startDate: day,
  endDate: day,
  note,
});

export const reportInput = z.object({
  condition: z.enum(CONDITIONS, { errorMap: () => ({ message: 'Choose how the item looks.' }) }),
  notes: note,
  photoIds: z.array(z.string()).max(LIMITS.photosPerReport, `Up to ${LIMITS.photosPerReport} photos.`).default([]),
});

const optionalReport = z.object({ report: reportInput.optional(), note }).default({});
const requiredReport = z.object({ report: reportInput });
const ownerReturn = z.object({
  report: reportInput.extend({ agrees: z.boolean().optional() }),
});
const reasonInput = z.object({ reason: note }).default({});
const messageInput = z.object({
  body: z.string().trim().min(1, 'Write a message first.').max(LIMITS.noteLength * 2),
});
export const extensionInput = z.object({ endDate: day, note });
const responseInput = z.object({ note }).default({});

// ---------------------------------------------------------------- helpers

function loadLoan(db: DB, id: string) {
  const row = one<any>(db, `SELECT * FROM loans WHERE id = ?`, id);
  if (!row) throw notFound('That borrowing request');
  return row;
}

function roleOf(loan: any, userId: string): 'owner' | 'borrower' | null {
  if (loan.owner_id === userId) return 'owner';
  if (loan.borrower_id === userId) return 'borrower';
  return null;
}

function requireRole(loan: any, userId: string, role: 'owner' | 'borrower') {
  const actual = roleOf(loan, userId);
  if (!actual) throw notFound('That borrowing request');
  if (actual !== role)
    throw forbidden(role === 'owner' ? 'Only the item’s owner can do that.' : 'Only the borrower can do that.');
}

function requireStatus(loan: any, allowed: LoanStatus[], message?: string) {
  if (!allowed.includes(loan.status)) {
    throw conflict(
      'illegal_transition',
      message ?? 'That step isn’t possible any more — things may have moved on. Refresh to see the latest.',
      { status: loan.status },
    );
  }
}

function logEvent(db: DB, loanId: string, actorId: string | null, type: string, detail: Record<string, unknown> = {}) {
  run(
    db,
    `INSERT INTO loan_events (loan_id, actor_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?)`,
    loanId, actorId, type, JSON.stringify(detail), nowIso(),
  );
}

function touch(db: DB, loanId: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  run(
    db,
    `UPDATE loans SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ...keys.map((k) => fields[k]), nowIso(), loanId,
  );
}

/** Confirmed bookings on this item that overlap [start, end], excluding one loan. */
function holdingConflicts(db: DB, itemId: string, start: string, end: string, exceptLoanId: string | null) {
  return all(
    db,
    `SELECT id, borrower_id, start_date, end_date, status FROM loans
      WHERE item_id = ? AND id <> ? AND status IN (${holding})
        AND start_date <= ? AND ? <= end_date
      ORDER BY start_date`,
    itemId, exceptLoanId ?? '', end, start,
  );
}

function addReport(
  db: DB,
  loanId: string,
  authorId: string,
  role: 'owner' | 'borrower',
  phase: 'handoff' | 'return' | 'followup',
  report: z.infer<typeof reportInput> & { agrees?: boolean },
) {
  const id = randomUUID();
  run(
    db,
    `INSERT INTO condition_reports (id, loan_id, author_id, role, phase, condition, agrees, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, loanId, authorId, role, phase, report.condition,
    report.agrees === undefined ? null : report.agrees ? 1 : 0,
    report.notes, nowIso(),
  );
  const seen = new Set<string>();
  report.photoIds.forEach((uploadId, position) => {
    if (seen.has(uploadId)) return;
    seen.add(uploadId);
    const upload = one<any>(db, `SELECT uploader_id FROM uploads WHERE id = ?`, uploadId);
    if (!upload) throw invalid('One of the photos couldn’t be found. Please add it again.');
    if (upload.uploader_id !== authorId) throw forbidden('You can only attach photos you took.');
    run(db, `INSERT INTO report_photos (report_id, upload_id, position) VALUES (?, ?, ?)`, id, uploadId, position);
  });
  logEvent(db, loanId, authorId, 'condition_reported', {
    reportId: id, phase, condition: report.condition, agrees: report.agrees ?? null, photos: seen.size,
  });
  return id;
}

/** Close any open extension proposal when a loan ends. */
function closePendingExtension(db: DB, loanId: string, actorId: string, reason: string) {
  const ext = one<any>(db, `SELECT id FROM extensions WHERE loan_id = ? AND status = 'pending'`, loanId);
  if (!ext) return;
  run(
    db,
    `UPDATE extensions SET status = 'withdrawn', response_note = ?, decided_by = ?, decided_at = ? WHERE id = ?`,
    reason, actorId, nowIso(), ext.id,
  );
  logEvent(db, loanId, null, 'extension_closed', { extensionId: ext.id, reason });
}

/** Run a state change atomically and translate database guard errors. */
function mutate<T>(db: DB, fn: () => T): T {
  try {
    return transaction(db, fn);
  } catch (err) {
    throw fromDbError(err);
  }
}

function formatRange(start: string, end: string) {
  return start === end ? start : `${start} → ${end}`;
}

// ---------------------------------------------------------------- requests

export function requestLoan(db: DB, actorId: string, input: unknown) {
  const data = parse(requestInput, input);
  const t = today();
  if (data.endDate < data.startDate) throw invalid('The return date needs to be on or after the pickup date.');
  if (data.startDate < t) throw invalid('Pick a start date from today onwards.');
  if (diffDays(t, data.startDate) > LIMITS.bookingHorizonDays) throw invalid('That’s a little far ahead — requests can be up to a year out.');

  const id = randomUUID();
  mutate(db, () => {
    const item = loadItem(db, data.itemId);
    if (item.owner_id === actorId) throw forbidden('This is your own item — no need to borrow it!');
    if (item.hidden) throw conflict('item_hidden', 'The owner has paused lending this item, so it can’t be requested right now.');
    const days = rangeLength(data.startDate, data.endDate);
    if (days > item.max_days)
      throw invalid(`This item can be borrowed for up to ${item.max_days} day${item.max_days === 1 ? '' : 's'} at a time.`);

    const duplicate = one<any>(
      db,
      `SELECT id FROM loans WHERE item_id = ? AND borrower_id = ? AND status IN (${open})
         AND start_date <= ? AND ? <= end_date`,
      item.id, actorId, data.endDate, data.startDate,
    );
    if (duplicate)
      throw conflict('duplicate_request', 'You already have a request for these dates.', { loanId: duplicate.id });

    const clash = holdingConflicts(db, item.id, data.startDate, data.endDate, null)[0];
    if (clash)
      throw conflict(
        'booking_conflict',
        `Those dates are already booked (${formatRange(clash.start_date, clash.end_date)}). Try different dates.`,
        { startDate: clash.start_date, endDate: clash.end_date },
      );

    const at = nowIso();
    run(
      db,
      `INSERT INTO loans (id, item_id, borrower_id, owner_id, status, start_date, end_date, original_end_date, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?)`,
      id, item.id, actorId, item.owner_id, data.startDate, data.endDate, data.endDate, data.note, at, at,
    );
    logEvent(db, id, actorId, 'requested', { startDate: data.startDate, endDate: data.endDate, note: data.note });
  });
  return getLoan(db, actorId, id);
}

export function approve(db: DB, actorId: string, loanId: string, input: unknown) {
  const { note: message } = parse(responseInput, input);
  mutate(db, () => {
    const loan = loadLoan(db, loanId);
    requireRole(loan, actorId, 'owner');
    requireStatus(loan, ['requested']);
    if (loan.end_date < today()) throw conflict('dates_passed', 'These dates have already passed, so the request can’t be approved.');
    const clash = holdingConflicts(db, loan.item_id, loan.start_date, loan.end_date, loan.id)[0];
    if (clash) {
      const who = publicUser(db, clash.borrower_id).firstName;
      throw conflict(
        'booking_conflict',
        `This overlaps ${who}’s booking (${formatRange(clash.start_date, clash.end_date)}), so it can’t be approved too.`,
        { loanId: clash.id },
      );
    }
    touch(db, loanId, { status: 'approved' });
    logEvent(db, loanId, actorId, 'approved', { message });
  });
  return getLoan(db, actorId, loanId);
}

export function decline(db: DB, actorId: string, loanId: string, input: unknown) {
  const { note: message } = parse(responseInput, input);
  mutate(db, () => {
    const loan = loadLoan(db, loanId);
    requireRole(loan, actorId, 'owner');
    requireStatus(loan, ['requested']);
    touch(db, loanId, { status: 'declined' });
    logEvent(db, loanId, actorId, 'declined', { message });
  });
  return getLoan(db, actorId, loanId);
}

/**
 * Borrowers can cancel any time before pickup. Owners can call off a
 * reservation they approved (before pickup); pending requests are declined instead.
 */
export function cancel(db: DB, actorId: string, loanId: string, input: unknown) {
  const { reason } = parse(reasonInput, input);
  mutate(db, () => {
    const loan = loadLoan(db, loanId);
    const role = roleOf(loan, actorId);
    if (!role) throw notFound('That borrowing request');
    if (role === 'borrower') requireStatus(loan, ['requested', 'approved', 'ready'], 'Once you have the item, return it instead of cancelling.');
    else requireStatus(loan, ['approved', 'ready'], loan.status === 'requested' ? 'Decline the request instead.' : undefined);
    touch(db, loanId, { status: 'cancelled' });
    closePendingExtension(db, loanId, actorId, 'The reservation was cancelled.');
    logEvent(db, loanId, actorId, 'cancelled', { reason, by: role });
  });
  return getLoan(db, actorId, loanId);
}

// ---------------------------------------------------------------- handoff & return

export function markReady(db: DB, actorId: string, loanId: string, input: unknown) {
  const data = parse(optionalReport, input);
  mutate(db, () => {
    const loan = loadLoan(db, loanId);
    requireRole(loan, actorId, 'owner');
    requireStatus(loan, ['approved']);
    if (loan.end_date < today()) throw conflict('dates_passed', 'These dates have passed. Agree new dates with an extension, or cancel.');
    touch(db, loanId, { status: 'ready' });
    logEvent(db, loanId, actorId, 'ready', { note: data.note });
    if (data.report) addReport(db, loanId, actorId, 'owner', 'handoff', data.report);
  });
  return getLoan(db, actorId, loanId);
}

export function confirmPickup(db: DB, actorId: string, loanId: string, input: unknown) {
  const data = parse(optionalReport, input);
  mutate(db, () => {
    const loan = loadLoan(db, loanId);
    requireRole(loan, actorId, 'borrower');
    requireStatus(loan, ['ready'], loan.status === 'approved' ? 'The owner hasn’t marked it ready yet.' : undefined);
    if (loan.end_date < today())
      throw conflict('dates_passed', 'These dates have passed. Ask for an extension first, or cancel.');
    touch(db, loanId, { status: 'borrowed', picked_up_at: nowIso() });
    logEvent(db, loanId, actorId, 'picked_up', { note: data.note });
    if (data.report) addReport(db, loanId, actorId, 'borrower', 'handoff', data.report);
  });
  return getLoan(db, actorId, loanId);
}

export function startReturn(db: DB, actorId: string, loanId: string, input: unknown) {
  const data = parse(requiredReport, input);
  mutate(db, () => {
    const loan = loadLoan(db, loanId);
    requireRole(loan, actorId, 'borrower');
    requireStatus(loan, ['borrowed']);
    touch(db, loanId, { status: 'returning' });
    closePendingExtension(db, loanId, actorId, 'The item is on its way back.');
    logEvent(db, loanId, actorId, 'return_started', { lateByDays: Math.max(0, diffDays(loan.end_date, today())) });
    addReport(db, loanId, actorId, 'borrower', 'return', data.report);
  });
  return getLoan(db, actorId, loanId);
}

/** The owner confirms it's back — normally after the borrower started the return, but also if they forgot. */
export function confirmReturn(db: DB, actorId: string, loanId: string, input: unknown) {
  const data = parse(ownerReturn, input);
  mutate(db, () => {
    const loan = loadLoan(db, loanId);
    requireRole(loan, actorId, 'owner');
    requireStatus(loan, ['borrowed', 'returning']);
    const borrowerReported = loan.status === 'returning';
    const report = { ...data.report, agrees: borrowerReported ? data.report.agrees ?? true : undefined };
    touch(db, loanId, { status: 'returned', returned_at: nowIso() });
    closePendingExtension(db, loanId, actorId, 'The item is back with its owner.');
    logEvent(db, loanId, actorId, 'returned', { lateByDays: Math.max(0, diffDays(loan.end_date, today())) });
    addReport(db, loanId, actorId, 'owner', 'return', report);
  });
  return getLoan(db, actorId, loanId);
}

/** Either person can add to the record after the return — nothing earlier is changed. */
export function addFollowUp(db: DB, actorId: string, loanId: string, input: unknown) {
  const data = parse(requiredReport, input);
  mutate(db, () => {
    const loan = loadLoan(db, loanId);
    const role = roleOf(loan, actorId);
    if (!role) throw notFound('That borrowing request');
    requireStatus(loan, ['returning', 'returned'], 'Condition notes can be added once the return has started.');
    addReport(db, loanId, actorId, role, 'followup', data.report);
  });
  return getLoan(db, actorId, loanId);
}

export function addMessage(db: DB, actorId: string, loanId: string, input: unknown) {
  const { body } = parse(messageInput, input);
  mutate(db, () => {
    const loan = loadLoan(db, loanId);
    if (!roleOf(loan, actorId)) throw notFound('That borrowing request');
    run(
      db,
      `INSERT INTO messages (id, loan_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`,
      randomUUID(), loanId, actorId, body, nowIso(),
    );
  });
  return getLoan(db, actorId, loanId);
}

// ---------------------------------------------------------------- extensions

const EXTENDABLE: LoanStatus[] = ['approved', 'ready', 'borrowed'];

export function proposeExtension(db: DB, actorId: string, loanId: string, input: unknown) {
  const data = parse(extensionInput, input);
  mutate(db, () => {
    const loan = loadLoan(db, loanId);
    requireRole(loan, actorId, 'borrower');
    requireStatus(loan, EXTENDABLE, 'Extensions can be asked for while the reservation or loan is active.');
    if (data.endDate <= loan.end_date) throw invalid('Choose a date after the current due date.');
    if (data.endDate < today()) throw invalid('Choose a new due date from today onwards.');
    if (diffDays(today(), data.endDate) > LIMITS.bookingHorizonDays) throw invalid('That’s too far ahead.');
    const pending = one(db, `SELECT 1 FROM extensions WHERE loan_id = ? AND status = 'pending'`, loanId);
    if (pending) throw conflict('extension_pending', 'You’ve already asked for an extension — waiting on an answer.');
    const clash = holdingConflicts(db, loan.item_id, addDays(loan.end_date, 1), data.endDate, loan.id)[0];
    if (clash) {
      const latest = addDays(clash.start_date, -1);
      throw conflict(
        'booking_conflict',
        latest > loan.end_date
          ? `Someone else has it booked from ${clash.start_date}. The latest you could ask for is ${latest}.`
          : `Someone else has it booked right after you, starting ${clash.start_date}, so it can’t be extended.`,
        { latestPossible: latest > loan.end_date ? latest : null },
      );
    }
    const id = randomUUID();
    run(
      db,
      `INSERT INTO extensions (id, loan_id, requested_by, from_end_date, new_end_date, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      id, loanId, actorId, loan.end_date, data.endDate, data.note, nowIso(),
    );
    logEvent(db, loanId, actorId, 'extension_proposed', { extensionId: id, from: loan.end_date, to: data.endDate, note: data.note });
  });
  return getLoan(db, actorId, loanId);
}

function loadExtension(db: DB, id: string) {
  const ext = one<any>(db, `SELECT * FROM extensions WHERE id = ?`, id);
  if (!ext) throw notFound('That extension request');
  return ext;
}

export function acceptExtension(db: DB, actorId: string, extensionId: string, input: unknown) {
  const { note: message } = parse(responseInput, input);
  let loanId = '';
  mutate(db, () => {
    const ext = loadExtension(db, extensionId);
    const loan = loadLoan(db, ext.loan_id);
    loanId = loan.id;
    requireRole(loan, actorId, 'owner');
    if (ext.status !== 'pending') throw conflict('illegal_transition', 'This extension has already been answered.');
    requireStatus(loan, EXTENDABLE);
    if (loan.end_date !== ext.from_end_date)
      throw conflict('stale_extension', 'The due date changed since this was asked. Decline it and ask for a fresh one.');
    // Recheck: someone may have been approved for those days since it was proposed.
    const clash = holdingConflicts(db, loan.item_id, loan.start_date, ext.new_end_date, loan.id)[0];
    if (clash) {
      const who = publicUser(db, clash.borrower_id).firstName;
      throw conflict(
        'booking_conflict',
        `This would overlap ${who}’s booking (${formatRange(clash.start_date, clash.end_date)}). You can decline it with a note instead.`,
        { loanId: clash.id },
      );
    }
    touch(db, loan.id, { end_date: ext.new_end_date });
    run(
      db,
      `UPDATE extensions SET status = 'accepted', response_note = ?, decided_by = ?, decided_at = ? WHERE id = ?`,
      message, actorId, nowIso(), ext.id,
    );
    logEvent(db, loan.id, actorId, 'extension_accepted', { extensionId: ext.id, from: ext.from_end_date, to: ext.new_end_date, message });
  });
  return getLoan(db, actorId, loanId);
}

export function declineExtension(db: DB, actorId: string, extensionId: string, input: unknown) {
  const { note: message } = parse(responseInput, input);
  let loanId = '';
  mutate(db, () => {
    const ext = loadExtension(db, extensionId);
    const loan = loadLoan(db, ext.loan_id);
    loanId = loan.id;
    requireRole(loan, actorId, 'owner');
    if (ext.status !== 'pending') throw conflict('illegal_transition', 'This extension has already been answered.');
    run(
      db,
      `UPDATE extensions SET status = 'declined', response_note = ?, decided_by = ?, decided_at = ? WHERE id = ?`,
      message, actorId, nowIso(), ext.id,
    );
    logEvent(db, loan.id, actorId, 'extension_declined', { extensionId: ext.id, to: ext.new_end_date, message });
  });
  return getLoan(db, actorId, loanId);
}

export function withdrawExtension(db: DB, actorId: string, extensionId: string) {
  let loanId = '';
  mutate(db, () => {
    const ext = loadExtension(db, extensionId);
    const loan = loadLoan(db, ext.loan_id);
    loanId = loan.id;
    requireRole(loan, actorId, 'borrower');
    if (ext.status !== 'pending') throw conflict('illegal_transition', 'This extension has already been answered.');
    run(
      db,
      `UPDATE extensions SET status = 'withdrawn', decided_by = ?, decided_at = ? WHERE id = ?`,
      actorId, nowIso(), ext.id,
    );
    logEvent(db, loan.id, actorId, 'extension_withdrawn', { extensionId: ext.id });
  });
  return getLoan(db, actorId, loanId);
}

// ---------------------------------------------------------------- views

export interface Action {
  key: string;
  enabled: boolean;
  reason?: string;
  extensionId?: string;
}

function lateness(loan: any) {
  const t = today();
  const active = loan.status === 'borrowed';
  const daysLate = active ? Math.max(0, diffDays(loan.end_date, t)) : 0;
  return {
    overdue: daysLate > 0,
    daysLate,
    dueToday: active && loan.end_date === t,
    datesPassed: ['requested', 'approved', 'ready'].includes(loan.status) && loan.end_date < t,
    startsInDays: diffDays(t, loan.start_date),
  };
}

function actionsFor(db: DB, loan: any, role: 'owner' | 'borrower', pendingExt: any): Action[] {
  const t = today();
  const passed = loan.end_date < t;
  const a: Action[] = [];
  const s: LoanStatus = loan.status;
  if (role === 'owner') {
    if (s === 'requested') {
      const clash = holdingConflicts(db, loan.item_id, loan.start_date, loan.end_date, loan.id)[0];
      a.push({
        key: 'approve',
        enabled: !clash && !passed,
        reason: passed
          ? 'These dates have already passed.'
          : clash
            ? `Overlaps ${publicUser(db, clash.borrower_id).firstName}’s booking (${formatRange(clash.start_date, clash.end_date)}).`
            : undefined,
      });
      a.push({ key: 'decline', enabled: true });
    }
    if (s === 'approved') a.push({ key: 'mark_ready', enabled: !passed, reason: passed ? 'These dates have passed.' : undefined });
    if (s === 'approved' || s === 'ready') a.push({ key: 'cancel', enabled: true });
    if (s === 'borrowed' || s === 'returning') a.push({ key: 'confirm_return', enabled: true });
    if (pendingExt && EXTENDABLE.includes(s)) {
      const clash = holdingConflicts(db, loan.item_id, loan.start_date, pendingExt.new_end_date, loan.id)[0];
      a.push({
        key: 'accept_extension',
        extensionId: pendingExt.id,
        enabled: !clash,
        reason: clash
          ? `Would overlap ${publicUser(db, clash.borrower_id).firstName}’s booking (${formatRange(clash.start_date, clash.end_date)}).`
          : undefined,
      });
      a.push({ key: 'decline_extension', extensionId: pendingExt.id, enabled: true });
    }
  } else {
    if (s === 'ready')
      a.push({ key: 'confirm_pickup', enabled: !passed, reason: passed ? 'These dates have passed — ask for an extension or cancel.' : undefined });
    if (s === 'borrowed') a.push({ key: 'start_return', enabled: true });
    if (EXTENDABLE.includes(s)) {
      if (pendingExt) a.push({ key: 'withdraw_extension', extensionId: pendingExt.id, enabled: true });
      else a.push({ key: 'propose_extension', enabled: true });
    }
    if (s === 'requested' || s === 'approved' || s === 'ready') a.push({ key: 'cancel', enabled: true });
  }
  if (s === 'returning' || s === 'returned') a.push({ key: 'add_followup', enabled: true });
  a.push({ key: 'message', enabled: true });
  return a;
}

function needsAttention(loan: any, role: 'owner' | 'borrower', hasPendingExt: boolean): boolean {
  const late = lateness(loan);
  if (role === 'owner') {
    if (loan.status === 'requested') return !late.datesPassed;
    if (loan.status === 'returning') return true;
    if (hasPendingExt && EXTENDABLE.includes(loan.status)) return true;
    if (loan.status === 'approved') return late.startsInDays <= 1 && !late.datesPassed;
    return false;
  }
  if (loan.status === 'ready') return true;
  if (loan.status === 'borrowed') return late.overdue || late.dueToday;
  return false;
}

function photoUrls(db: DB, reportId: string) {
  return all(
    db,
    `SELECT u.file_name FROM report_photos p JOIN uploads u ON u.id = p.upload_id
      WHERE p.report_id = ? ORDER BY p.position`,
    reportId,
  ).map((r) => `/uploads/${r.file_name}`);
}

function itemCard(db: DB, itemId: string) {
  const item = loadItem(db, itemId);
  return {
    id: item.id,
    title: item.title,
    imageUrl: item.image_url,
    category: item.category,
    hidden: !!item.hidden,
    pickupNotes: item.pickup_notes,
    careNotes: item.care_notes,
    maxDays: item.max_days,
  };
}

function loanCard(db: DB, loan: any, viewerId: string) {
  const role = roleOf(loan, viewerId)!;
  const pendingExt = one<any>(db, `SELECT * FROM extensions WHERE loan_id = ? AND status = 'pending'`, loan.id);
  const disputed = !!one(
    db,
    `SELECT 1 FROM condition_reports WHERE loan_id = ? AND role = 'owner' AND phase = 'return' AND agrees = 0`,
    loan.id,
  );
  return {
    id: loan.id,
    role,
    status: loan.status as LoanStatus,
    startDate: loan.start_date,
    endDate: loan.end_date,
    originalEndDate: loan.original_end_date,
    note: loan.note,
    createdAt: loan.created_at,
    updatedAt: loan.updated_at,
    pickedUpAt: loan.picked_up_at,
    returnedAt: loan.returned_at,
    item: itemCard(db, loan.item_id),
    owner: publicUser(db, loan.owner_id),
    borrower: publicUser(db, loan.borrower_id),
    ...lateness(loan),
    pendingExtension: pendingExt
      ? { id: pendingExt.id, newEndDate: pendingExt.new_end_date, fromEndDate: pendingExt.from_end_date, note: pendingExt.note, createdAt: pendingExt.created_at }
      : null,
    disputed,
    needsAttention: needsAttention(loan, role, !!pendingExt),
  };
}

export function getLoan(db: DB, viewerId: string, loanId: string) {
  const loan = loadLoan(db, loanId);
  const role = roleOf(loan, viewerId);
  if (!role) throw notFound('That borrowing request');
  const card = loanCard(db, loan, viewerId);
  const pendingExt = one<any>(db, `SELECT * FROM extensions WHERE loan_id = ? AND status = 'pending'`, loan.id);

  const events = all(db, `SELECT * FROM loan_events WHERE loan_id = ? ORDER BY seq`, loanId).map((e) => ({
    seq: e.seq,
    type: e.type,
    actor: e.actor_id ? publicUser(db, e.actor_id) : null,
    detail: JSON.parse(e.detail),
    at: e.created_at,
  }));
  const reports = all(db, `SELECT * FROM condition_reports WHERE loan_id = ? ORDER BY created_at, rowid`, loanId).map((r) => ({
    id: r.id,
    author: publicUser(db, r.author_id),
    role: r.role,
    phase: r.phase,
    condition: r.condition,
    agrees: r.agrees === null ? null : !!r.agrees,
    notes: r.notes,
    photos: photoUrls(db, r.id),
    at: r.created_at,
  }));
  const extensions = all(db, `SELECT * FROM extensions WHERE loan_id = ? ORDER BY created_at, rowid`, loanId).map((x) => ({
    id: x.id,
    fromEndDate: x.from_end_date,
    newEndDate: x.new_end_date,
    note: x.note,
    status: x.status,
    responseNote: x.response_note,
    createdAt: x.created_at,
    decidedAt: x.decided_at,
  }));
  const messages = all(db, `SELECT * FROM messages WHERE loan_id = ? ORDER BY created_at, rowid`, loanId).map((m) => ({
    id: m.id,
    author: publicUser(db, m.author_id),
    body: m.body,
    at: m.created_at,
  }));

  // For the owner deciding on a request: what else wants these dates?
  let overlapping: { id: string; borrower: ReturnType<typeof publicUser>; startDate: string; endDate: string; status: string }[] = [];
  if (role === 'owner' && (['requested', 'approved', 'ready'].includes(loan.status) || pendingExt)) {
    const end = pendingExt ? pendingExt.new_end_date : loan.end_date;
    overlapping = all(
      db,
      `SELECT id, borrower_id, start_date, end_date, status FROM loans
        WHERE item_id = ? AND id <> ? AND status IN (${open})
          AND start_date <= ? AND ? <= end_date ORDER BY start_date`,
      loan.item_id, loan.id, end, loan.start_date,
    ).map((o) => ({ id: o.id, borrower: publicUser(db, o.borrower_id), startDate: o.start_date, endDate: o.end_date, status: o.status }));
  }

  return {
    ...card,
    today: today(),
    events,
    reports,
    extensions,
    messages,
    overlapping,
    actions: actionsFor(db, loan, role, pendingExt),
  };
}

export function listLoansFor(db: DB, viewerId: string) {
  const rows = all(
    db,
    `SELECT * FROM loans WHERE borrower_id = ? OR owner_id = ? ORDER BY start_date DESC, created_at DESC`,
    viewerId, viewerId,
  );
  const cards = rows.map((r) => loanCard(db, r, viewerId));
  return {
    borrowing: cards.filter((c) => c.role === 'borrower'),
    lending: cards.filter((c) => c.role === 'owner'),
  };
}

export function attentionCounts(db: DB, viewerId: string) {
  const { borrowing, lending } = listLoansFor(db, viewerId);
  return {
    borrowing: borrowing.filter((c) => c.needsAttention).length,
    lending: lending.filter((c) => c.needsAttention).length,
  };
}

export { AppError };
