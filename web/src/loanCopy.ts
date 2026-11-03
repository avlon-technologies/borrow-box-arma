import { formatDay, formatDayWeekday, formatRange, plural, relativeDay } from './format.ts';
import type { LoanCard } from './types.ts';

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent';

/** Short status label for lists and pills — never a raw database status. */
export function statusLabel(loan: LoanCard): { text: string; tone: Tone } {
  const you = loan.role === 'borrower';
  switch (loan.status) {
    case 'requested':
      if (loan.datesPassed) return { text: 'Dates have passed', tone: 'neutral' };
      return you ? { text: `Waiting for ${loan.owner.firstName}`, tone: 'info' } : { text: 'New request', tone: 'accent' };
    case 'approved':
      return loan.datesPassed ? { text: 'Dates have passed', tone: 'warn' } : { text: 'Reserved', tone: 'good' };
    case 'ready':
      return loan.datesPassed ? { text: 'Pickup missed', tone: 'warn' } : { text: 'Ready for pickup', tone: 'accent' };
    case 'borrowed':
      if (loan.overdue) return { text: `${plural(loan.daysLate, 'day')} late`, tone: 'warn' };
      if (loan.dueToday) return { text: 'Due back today', tone: 'info' };
      return you ? { text: 'With you', tone: 'good' } : { text: `With ${loan.borrower.firstName}`, tone: 'good' };
    case 'returning':
      return { text: 'On its way back', tone: 'info' };
    case 'returned':
      return loan.disputed ? { text: 'Returned · notes differ', tone: 'neutral' } : { text: 'Returned', tone: 'neutral' };
    case 'declined':
      return { text: 'Not this time', tone: 'neutral' };
    case 'cancelled':
      return { text: 'Cancelled', tone: 'neutral' };
  }
}

/** One line for list rows explaining where things stand. */
export function summaryLine(loan: LoanCard, today: string): string {
  const you = loan.role === 'borrower';
  const other = you ? loan.owner.firstName : loan.borrower.firstName;
  const dates = formatRange(loan.startDate, loan.endDate);
  switch (loan.status) {
    case 'requested':
      return you ? `You asked for ${dates}` : `${other} would like it ${dates}`;
    case 'approved':
      return you ? `Pickup ${relativeDay(loan.startDate, today)} · ${dates}` : `Reserved for ${other} · pickup ${relativeDay(loan.startDate, today)}`;
    case 'ready':
      return you ? `${other} has it ready for you` : `Waiting for ${other} to pick it up`;
    case 'borrowed':
      if (loan.overdue) return you ? `Was due back ${formatDay(loan.endDate)}` : `${other} was due to return it ${formatDay(loan.endDate)}`;
      return `Due back ${relativeDay(loan.endDate, today)}`;
    case 'returning':
      return you ? `Waiting for ${other} to confirm it’s back` : `${other} is bringing it back — confirm when it’s home`;
    case 'returned':
      return `Borrowed ${dates}`;
    case 'declined':
      return `Request for ${dates}`;
    case 'cancelled':
      return `Was for ${dates}`;
  }
}

export interface Stage {
  title: string;
  body: string;
  tone: Tone;
}

/** The headline on a loan page: what's happening and what happens next. */
export function stage(loan: LoanCard, today: string): Stage {
  const you = loan.role === 'borrower';
  const owner = loan.owner.firstName;
  const borrower = loan.borrower.firstName;
  const item = loan.item.title.toLowerCase();
  const dates = `${formatDayWeekday(loan.startDate)} → ${formatDayWeekday(loan.endDate)}`;
  switch (loan.status) {
    case 'requested':
      if (loan.datesPassed)
        return { title: 'These dates have come and gone', body: you ? 'You can cancel this request and ask again for new dates.' : 'This request can no longer be approved — you can decline it.', tone: 'neutral' };
      return you
        ? { title: `Request sent to ${owner}`, body: `You’ve asked for ${dates}. ${owner} will approve or decline — you’ll see the answer right here.`, tone: 'info' }
        : { title: `${borrower} would like to borrow your ${item}`, body: `For ${dates}. Approving reserves those dates for ${borrower}.`, tone: 'accent' };
    case 'approved':
      if (loan.datesPassed)
        return { title: 'The pickup never happened', body: you ? 'These dates have passed. Ask for more time if you still need it, or cancel.' : 'These dates have passed. You can cancel the reservation.', tone: 'warn' };
      return you
        ? { title: `You’re booked for ${dates}`, body: `${owner} will let you know when it’s ready for pickup.`, tone: 'good' }
        : { title: `Reserved for ${borrower}`, body: `Pickup is ${relativeDay(loan.startDate, today)}. When it’s ready to collect, let ${borrower} know.`, tone: 'good' };
    case 'ready':
      if (loan.datesPassed)
        return { title: 'Still waiting to be collected', body: you ? 'Your dates have passed — ask for more time first, or cancel.' : `${borrower}’s dates have passed. You can cancel the reservation.`, tone: 'warn' };
      return you
        ? { title: 'Ready for pickup', body: `${owner} has it ready for you. Confirm once it’s in your hands — it’s due back ${formatDayWeekday(loan.endDate)}.`, tone: 'accent' }
        : { title: `Waiting for ${borrower} to collect it`, body: `${borrower} will confirm when they’ve picked it up.`, tone: 'info' };
    case 'borrowed':
      if (loan.overdue)
        return you
          ? { title: `This was due back ${relativeDay(loan.endDate, today)}`, body: `No stress — life happens. Let ${owner} know when it’s coming back, ask for more time, or start the return.`, tone: 'warn' }
          : { title: `${borrower} is ${plural(loan.daysLate, 'day')} late bringing it back`, body: `It was due ${formatDayWeekday(loan.endDate)}. A friendly message usually does it. If it’s already home, you can confirm the return yourself.`, tone: 'warn' };
      return you
        ? { title: `Enjoy! Due back ${relativeDay(loan.endDate, today)}`, body: `Need longer? Ask ${owner} for more time. When you’re done, start the return.`, tone: 'good' }
        : { title: `${borrower} has it`, body: `Due back ${relativeDay(loan.endDate, today)} (${formatDayWeekday(loan.endDate)}).`, tone: 'good' };
    case 'returning':
      return you
        ? { title: 'Thanks for bringing it back', body: `${owner} will confirm once it’s home and add their own condition notes.`, tone: 'info' }
        : { title: `${borrower} is returning it`, body: 'Check it over, then confirm it’s back. Your notes are kept alongside theirs — nothing is overwritten.', tone: 'accent' };
    case 'returned':
      if (loan.disputed)
        return { title: 'Back home — with differing notes', body: `${owner} and ${borrower} described the condition differently. Both accounts are kept below, side by side.`, tone: 'neutral' };
      return { title: you ? 'All done — thanks for borrowing kindly' : 'Back home with you', body: `Borrowed ${dates}.`, tone: 'good' };
    case 'declined':
      return { title: you ? `${owner} can’t lend it this time` : 'You declined this request', body: 'Nothing was booked.', tone: 'neutral' };
    case 'cancelled':
      return { title: 'This was cancelled', body: 'Nothing is booked for these dates any more.', tone: 'neutral' };
  }
}

export const STEPS = [
  { key: 'requested', label: 'Requested' },
  { key: 'approved', label: 'Reserved' },
  { key: 'ready', label: 'Ready' },
  { key: 'borrowed', label: 'Borrowed' },
  { key: 'returned', label: 'Returned' },
] as const;

export function stepIndex(status: string): number {
  const order = ['requested', 'approved', 'ready', 'borrowed', 'returning', 'returned'];
  const i = order.indexOf(status);
  if (status === 'returning') return 3;
  if (status === 'returned') return 4;
  return i;
}

export function eventText(type: string, detail: Record<string, any>, actorName: string, loan: LoanCard): string {
  switch (type) {
    case 'requested':
      return `${actorName} asked to borrow it for ${formatRange(detail.startDate, detail.endDate)}`;
    case 'approved':
      return `${actorName} approved the request`;
    case 'declined':
      return `${actorName} declined the request`;
    case 'cancelled':
      return `${actorName} cancelled${detail.by === 'owner' ? ' the reservation' : ''}`;
    case 'ready':
      return `${actorName} marked it ready for pickup`;
    case 'picked_up':
      return `${actorName} picked it up`;
    case 'return_started':
      return detail.lateByDays > 0 ? `${actorName} started the return (${plural(detail.lateByDays, 'day')} late)` : `${actorName} started the return`;
    case 'returned':
      return `${actorName} confirmed it’s back`;
    case 'condition_reported':
      return `${actorName} added condition notes${detail.photos ? ` with ${plural(detail.photos, 'photo')}` : ''}`;
    case 'extension_proposed':
      return `${actorName} asked to keep it until ${formatDay(detail.to)}`;
    case 'extension_accepted':
      return `${actorName} agreed — new due date ${formatDay(detail.to)}`;
    case 'extension_declined':
      return `${actorName} said no to keeping it until ${formatDay(detail.to)}`;
    case 'extension_withdrawn':
      return `${actorName} withdrew the extension request`;
    case 'extension_closed':
      return `The open extension request was closed — ${String(detail.reason ?? '').toLowerCase().replace(/\.$/, '')}`;
    default:
      return `${actorName} updated this (${type.replace(/_/g, ' ')}) on ${loan.item.title}`;
  }
}
