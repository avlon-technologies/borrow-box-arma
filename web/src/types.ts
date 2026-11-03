import type { LoanStatus } from '../../shared/constants.ts';
export type { LoanStatus };

export interface Person {
  id: string;
  name: string;
  firstName: string;
  neighbourhood: string;
  bio: string;
  avatarHue: number;
  memberSince: string;
}

export interface CircleTag {
  id: string;
  name: string;
  hue: number;
}

export type Audience = 'everyone' | 'circles';

export interface Availability {
  state: 'available' | 'out';
  backOn: string | null;
  overdue: boolean;
  returning: boolean;
  nextBookedFrom: string | null;
}

export interface ItemSummary {
  id: string;
  title: string;
  category: string;
  imageUrl: string | null;
  hidden: boolean;
  maxDays: number;
  owner: Person;
  isMine: boolean;
  availability: Availability;
  audience: Audience;
  circles: CircleTag[];
}

export interface OwnItem extends ItemSummary {
  openRequests: number;
  activeLoan: boolean;
}

export interface Booking {
  loanId: string | null;
  startDate: string;
  endDate: string;
  status: LoanStatus;
  mine: boolean;
  borrower: Person | null;
}

export interface ItemDetail extends ItemSummary {
  description: string;
  pickupNotes: string;
  careNotes: string;
  bookings: Booking[];
  myOpenLoans: { id: string; status: LoanStatus; startDate: string; endDate: string }[];
  pendingRequests: { id: string; borrower: Person; startDate: string; endDate: string; note: string; createdAt: string }[];
  canRequest: { ok: boolean; reason?: string };
  viaCircle: CircleTag | null;
}

export interface LoanCard {
  id: string;
  role: 'owner' | 'borrower';
  status: LoanStatus;
  startDate: string;
  endDate: string;
  originalEndDate: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  pickedUpAt: string | null;
  returnedAt: string | null;
  item: { id: string; title: string; imageUrl: string | null; category: string; hidden: boolean; audience: Audience; pickupNotes: string; careNotes: string; maxDays: number };
  owner: Person;
  borrower: Person;
  overdue: boolean;
  daysLate: number;
  dueToday: boolean;
  datesPassed: boolean;
  startsInDays: number;
  pendingExtension: { id: string; newEndDate: string; fromEndDate: string; note: string; createdAt: string } | null;
  disputed: boolean;
  needsAttention: boolean;
  /** The circle that let the borrower ask, if the item is circle-only. */
  via: (CircleTag & { borrowerStillMember: boolean; borrowerLeft: { how: 'left' | 'removed'; at: string } | null }) | null;
}

export interface Action {
  key: string;
  enabled: boolean;
  reason?: string;
  extensionId?: string;
}

export interface Report {
  id: string;
  author: Person;
  role: 'owner' | 'borrower';
  phase: 'handoff' | 'return' | 'followup';
  condition: string;
  agrees: boolean | null;
  notes: string;
  photos: string[];
  at: string;
}

export interface LoanEvent {
  seq: number;
  type: string;
  actor: Person | null;
  detail: Record<string, any>;
  at: string;
}

export interface LoanDetail extends LoanCard {
  today: string;
  events: LoanEvent[];
  reports: Report[];
  extensions: { id: string; fromEndDate: string; newEndDate: string; note: string; status: string; responseNote: string; createdAt: string; decidedAt: string | null }[];
  messages: { id: string; author: Person; body: string; at: string }[];
  overlapping: { id: string; borrower: Person; startDate: string; endDate: string; status: LoanStatus }[];
  actions: Action[];
}

export interface Config {
  timeZone: string;
  today: string;
  categories: string[];
  conditions: { value: string; label: string }[];
  limits: { noteLength: number; photosPerReport: number; uploadBytes: number };
}

export interface CircleSummary extends CircleTag {
  description: string;
  createdAt: string;
  members: Person[];
  memberCount: number;
  itemCount: number;
  myRole: 'organizer' | 'member' | null;
}

export interface CircleInvitation extends CircleSummary {
  invitedBy: Person | null;
  invitedAt: string;
}

export interface CircleMember {
  person: Person;
  status: 'active' | 'invited';
  role: 'organizer' | 'member';
  since: string;
  invitedBy: Person | null;
  items: number;
}

export interface CircleEvent {
  seq: number;
  type: string;
  actor: Person | null;
  subject: Person | null;
  detail: Record<string, any>;
  at: string;
}

export interface CircleDetail extends Omit<CircleSummary, 'members'> {
  me: { status: 'active' | 'invited'; role: 'organizer' | 'member' | null; invitedBy: Person | null };
  members: CircleMember[];
  invited: CircleMember[];
  shelf: ItemSummary[];
  shelfPreview: string[];
  activity: CircleEvent[];
}

export interface MembershipImpact {
  person: Person;
  borrowing: { loanId: string; title: string; status: LoanStatus; startDate: string; endDate: string; owner: Person; commitment: boolean }[];
  lending: { loanId: string; title: string; status: LoanStatus; startDate: string; endDate: string; borrower: Person }[];
  items: { id: string; title: string; becomesUnshared: boolean }[];
  lastOrganizer: boolean;
}
