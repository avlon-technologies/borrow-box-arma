/** A rule was broken. `message` is written for the person using the app. */
export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'That') =>
  new AppError(404, 'not_found', `${what} couldn’t be found. It may have been removed or you may not have access.`);

export const forbidden = (message = 'Only the people involved can do that.') =>
  new AppError(403, 'forbidden', message);

export const invalid = (message: string, details?: unknown) =>
  new AppError(400, 'invalid', message, details);

export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

export const unauthenticated = () =>
  new AppError(401, 'unauthenticated', 'Please choose who you are to continue.');

/** Translate errors raised by database guards into friendly AppErrors. */
export function fromDbError(err: unknown): unknown {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('BOOKING_CONFLICT'))
    return conflict('booking_conflict', 'Those dates overlap with another confirmed booking for this item.');
  if (msg.includes('ILLEGAL_TRANSITION'))
    return conflict('illegal_transition', 'That step isn’t possible any more — things may have moved on. Refresh to see the latest.');
  if (msg.includes('APPEND_ONLY'))
    return conflict('append_only', 'History can’t be changed once it’s recorded.');
  if (msg.includes('UNIQUE constraint failed: extensions.loan_id'))
    return conflict('extension_pending', 'There’s already an extension waiting for an answer.');
  return err;
}
