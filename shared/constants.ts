// Vocabulary shared by the server and the web app.

export const CATEGORIES = [
  'Tools',
  'Outdoors',
  'Kitchen',
  'Electronics',
  'Home & Garden',
  'Kids',
  'Hobbies',
  'Party',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CONDITIONS = ['like_new', 'good', 'worn', 'damaged', 'missing_parts'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABELS: Record<Condition, string> = {
  like_new: 'Like new',
  good: 'Good, normal use',
  worn: 'Showing some wear',
  damaged: 'Something’s damaged',
  missing_parts: 'Something’s missing',
};

export type LoanStatus =
  | 'requested'
  | 'approved'
  | 'ready'
  | 'borrowed'
  | 'returning'
  | 'returned'
  | 'declined'
  | 'cancelled';

/** Statuses during which the item is held for this loan. */
export const HOLDING_STATUSES: LoanStatus[] = ['approved', 'ready', 'borrowed', 'returning'];
export const OPEN_STATUSES: LoanStatus[] = ['requested', ...HOLDING_STATUSES];

export const LIMITS = {
  noteLength: 600,
  titleLength: 80,
  descriptionLength: 1500,
  photosPerReport: 6,
  uploadBytes: 6 * 1024 * 1024,
  bookingHorizonDays: 365,
};
