import { Link } from 'react-router-dom';
import { Globe, Lock } from 'lucide-react';
import { Avatar } from './ui.tsx';
import type { Audience, CircleEvent, CircleTag, Person } from '../types.ts';

/** The friendly colours a circle can wear (matches the server's choices). */
export const CIRCLE_HUES = [18, 42, 95, 150, 190, 220, 265, 330];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w) && !['the', 'of', 'and', '&'].includes(w.toLowerCase()))
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join('') || name.slice(0, 1).toUpperCase();

/** A circle's badge: a soft coloured tile with its initials. */
export function CircleMark({ circle, size = 44 }: { circle: Pick<CircleTag, 'name' | 'hue'>; size?: number }) {
  return (
    <span
      className="circle-mark"
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        borderRadius: size * 0.32,
        background: `linear-gradient(135deg, hsl(${circle.hue} 70% 90%), hsl(${circle.hue} 55% 80%))`,
        color: `hsl(${circle.hue} 50% 26%)`,
      }}
    >
      {initials(circle.name)}
    </span>
  );
}

/** A small "shared with" tag; links to the circle when the viewer belongs to it. */
export function CircleChip({ circle, link = true }: { circle: CircleTag; link?: boolean }) {
  const body = (
    <>
      <i style={{ background: `hsl(${circle.hue} 55% 55%)` }} aria-hidden />
      {circle.name}
    </>
  );
  return link ? (
    <Link to={`/circles/${circle.id}`} className="circle-chip">
      {body}
    </Link>
  ) : (
    <span className="circle-chip">{body}</span>
  );
}

/** One line saying who can ask for an item. */
export function AudienceLine({ audience, circles, mine }: { audience: Audience; circles: CircleTag[]; mine?: boolean }) {
  if (audience === 'everyone')
    return (
      <span className="audience-line">
        <Globe size={14} aria-hidden /> Anyone can ask
      </span>
    );
  if (circles.length === 0)
    return (
      <span className="audience-line warn">
        <Lock size={14} aria-hidden /> {mine ? 'Circles only — but not in a circle yet' : 'Circles only'}
      </span>
    );
  return (
    <span className="audience-line">
      <Lock size={14} aria-hidden /> {circles.length === 1 ? `${circles[0].name} only` : `${circles.length} circles only`}
    </span>
  );
}

export function AvatarStack({ people, max = 5, size = 28 }: { people: Person[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  return (
    <span className="avatar-stack" aria-label={people.map((p) => p.firstName).join(', ')}>
      {shown.map((p) => (
        <Avatar key={p.id} person={p} size={size} />
      ))}
      {more > 0 && (
        <span className="avatar avatar-more" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
          +{more}
        </span>
      )}
    </span>
  );
}

/** Circle history in plain words. */
export function circleEventText(e: CircleEvent, meId: string | undefined): string {
  const who = (p: Person | null) => (!p ? 'BorrowBox' : p.id === meId ? 'You' : p.firstName);
  const whom = (p: Person | null) => (!p ? 'someone' : p.id === meId ? 'you' : p.firstName);
  const a = who(e.actor);
  switch (e.type) {
    case 'created':
      return `${a} started the circle`;
    case 'renamed':
      return `${a} renamed the circle to “${e.detail.to}”`;
    case 'invited':
      return `${a} invited ${whom(e.subject)}`;
    case 'invite_withdrawn':
      return `${a} withdrew ${whom(e.subject) === 'you' ? 'your' : `${whom(e.subject)}’s`} invitation`;
    case 'joined':
      return `${a} joined`;
    case 'declined':
      return `${a} declined the invitation`;
    case 'left':
      return `${a} left the circle`;
    case 'removed':
      return `${a} removed ${whom(e.subject)} from the circle`;
    case 'organizer_added':
      return `${a} made ${whom(e.subject)} an organizer`;
    case 'item_shared':
      return `${a} shared ${e.detail.title}`;
    case 'item_unshared':
      return e.detail.reason
        ? `${e.detail.title} left the shelf with its owner`
        : `${a} took ${e.detail.title} off the shelf`;
    default:
      return `${a} updated the circle`;
  }
}

/** "Who can ask for it?" — the same two choices wherever an item is shared. */
export function AudienceChoice({ circleOnly, onChange, circleName }: { circleOnly: boolean; onChange: (v: boolean) => void; circleName?: string }) {
  return (
    <fieldset className="audience-choice">
      <legend className="field-label">Who can ask to borrow it?</legend>
      <label className={`audience-option ${!circleOnly ? 'on' : ''}`}>
        <input type="radio" name="audience" checked={!circleOnly} onChange={() => onChange(false)} />
        <span>
          <strong>Anyone on BorrowBox</strong>
          <small>It also shows on {circleName ? 'this circle’s' : 'your circles’'} shelf.</small>
        </span>
      </label>
      <label className={`audience-option ${circleOnly ? 'on' : ''}`}>
        <input type="radio" name="audience" checked={circleOnly} onChange={() => onChange(true)} />
        <span>
          <strong>Circle members only</strong>
          <small>Only people in {circleName ?? 'the circles you choose'} can see it and ask.</small>
        </span>
      </label>
    </fieldset>
  );
}
