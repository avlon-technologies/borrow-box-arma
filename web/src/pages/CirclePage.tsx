import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarCheck, Crown, History, LogOut, PackageOpen, Pencil, Plus, ShieldCheck, UserMinus, UserPlus, X } from 'lucide-react';
import { api, useAction, useApi } from '../api.ts';
import { useSession } from '../session.tsx';
import { useToast } from '../toast.tsx';
import { formatRange, onDay, plural, possessive, timeAgo } from '../format.ts';
import { Avatar, BackLink, Button, EmptyState, ErrorState, InlineError, Spinner } from '../components/ui.tsx';
import { ItemCard } from '../components/ItemCard.tsx';
import { AudienceChoice, AudienceLine, AvatarStack, CircleMark, circleEventText } from '../components/circles.tsx';
import { NotFound } from './NotFound.tsx';
import type { CircleDetail, CircleMember, MembershipImpact, OwnItem, Person } from '../types.ts';

export function CirclePage() {
  const { id } = useParams();
  const { data: circle, error, loading, reload, setData } = useApi<CircleDetail>(`/circles/${id}`, { refreshOnFocus: true });
  if (error?.status === 404)
    return (
      <NotFound
        title={error.code === 'not_a_member' ? 'You’re not in this circle any more' : 'Circle not found'}
        message={
          error.code === 'not_a_member'
            ? 'Anything you’d already arranged through it still goes ahead — you’ll find it under Borrowing and Lending.'
            : error.message
        }
      />
    );
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !circle) return <Spinner label="Loading circle" />;
  if (circle.me.status === 'invited') return <InvitationPreview circle={circle} onJoined={setData} />;
  return <Circle circle={circle} setCircle={setData} reload={reload} />;
}

function Header({ circle, children }: { circle: CircleDetail; children?: React.ReactNode }) {
  return (
    <header className="circle-header">
      <CircleMark circle={circle} size={88} />
      <div className="circle-header-text">
        <p className="eyebrow">
          Circle · {plural(circle.memberCount, 'member')} · {plural(circle.itemCount, 'thing')} on the shelf
        </p>
        <h1>{circle.name}</h1>
        {circle.description && <p className="circle-desc">{circle.description}</p>}
      </div>
      {children}
    </header>
  );
}

function InvitationPreview({ circle, onJoined }: { circle: CircleDetail; onJoined: (c: CircleDetail) => void }) {
  const { refresh } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const join = useAction();
  const decline = useAction();
  async function answer(accept: boolean) {
    const act = accept ? join : decline;
    const res = await act.run((key) => api<CircleDetail>(`/circles/${circle.id}/${accept ? 'join' : 'decline'}`, { body: {}, idempotencyKey: key }));
    if (!res) return;
    refresh();
    if (accept) {
      toast(`Welcome to ${circle.name}`);
      onJoined(res);
    } else {
      toast('Invitation declined');
      navigate('/circles', { replace: true });
    }
  }
  return (
    <div className="circle-page">
      <BackLink to="/circles">Circles</BackLink>
      <Header circle={circle} />
      <section className="next-step tone-accent invite-banner" aria-labelledby="inv-h">
        <h2 id="inv-h">{circle.me.invitedBy ? `${circle.me.invitedBy.firstName} invited you to join` : 'You’re invited to join'}</h2>
        <p className="next-body">
          Members can borrow things kept just for the circle, and share their own. You can leave any time — anything you’ve
          arranged still goes ahead.
        </p>
        <div className="row gap wrap">
          <AvatarStack people={circle.members.map((m) => m.person)} />
          <span className="muted">{circle.members.map((m) => m.person.firstName).join(', ')}</span>
        </div>
        {circle.shelfPreview.length > 0 && (
          <p className="muted">
            <PackageOpen size={16} aria-hidden className="inline-icon" /> On the shelf: {circle.shelfPreview.join(', ')}
          </p>
        )}
        <InlineError error={join.error ?? decline.error} />
        <div className="next-actions">
          <Button pending={join.pending} disabled={decline.pending} onClick={() => answer(true)}>
            Join {circle.name}
          </Button>
          <Button variant="ghost" pending={decline.pending} disabled={join.pending} onClick={() => answer(false)}>
            No thanks
          </Button>
        </div>
      </section>
    </div>
  );
}

function Circle({ circle, setCircle, reload }: { circle: CircleDetail; setCircle: (c: CircleDetail) => void; reload: () => void }) {
  const { user, today } = useSession();
  const organizer = circle.me.role === 'organizer';
  return (
    <div className="circle-page">
      <BackLink to="/circles">Circles</BackLink>
      <Header circle={circle}>
        {organizer && (
          <Link className="btn btn-secondary" to={`/circles/${circle.id}/edit`}>
            <Pencil size={16} aria-hidden />
            <span>Edit</span>
          </Link>
        )}
      </Header>

      <div className="circle-layout">
        <div className="circle-main">
          <section className="panel" aria-labelledby="shelf-h">
            <div className="panel-head">
              <h2 id="shelf-h">
                <PackageOpen size={20} aria-hidden /> The shelf
              </h2>
            </div>
            <ShareFromShelf circle={circle} setCircle={setCircle} />
            {circle.shelf.length === 0 ? (
              <EmptyState icon={<PackageOpen size={28} />} title="Nothing on the shelf yet">
                Share something you’d lend these friends — a drill, a tent, the good cake tins.
              </EmptyState>
            ) : (
              <div className="grid">
                {circle.shelf.map((item) => (
                  <ShelfItem key={item.id} circleId={circle.id} item={item} mine={item.owner.id === user?.id} today={today} setCircle={setCircle} />
                ))}
              </div>
            )}
          </section>
        </div>
        <aside className="circle-side">
          <Members circle={circle} setCircle={setCircle} reload={reload} />
          <Activity circle={circle} />
        </aside>
      </div>
    </div>
  );
}

function ShelfItem({ circleId, item, mine, today, setCircle }: { circleId: string; item: CircleDetail['shelf'][number]; mine: boolean; today: string; setCircle: (c: CircleDetail) => void }) {
  const action = useAction();
  const toast = useToast();
  async function takeOff() {
    const next = await action.run((key) => api<CircleDetail>(`/circles/${circleId}/items/${item.id}/remove`, { body: {}, idempotencyKey: key }));
    if (next) {
      setCircle(next);
      toast(`${item.title} is off the shelf. Existing bookings are unchanged.`);
    }
  }
  return (
    <div className="shelf-item">
      <ItemCard item={item} today={today} extra={<AudienceLine audience={item.audience} circles={item.circles} mine={mine} />} />
      {mine && (
        <Button variant="quiet" pending={action.pending} onClick={takeOff} aria-label={`Take ${item.title} off this shelf`}>
          Take off shelf
        </Button>
      )}
      <InlineError error={action.error} />
    </div>
  );
}

function ShareFromShelf({ circle, setCircle }: { circle: CircleDetail; setCircle: (c: CircleDetail) => void }) {
  const [open, setOpen] = useState(false);
  const mine = useApi<OwnItem[]>(open ? '/my/items' : null);
  const [itemId, setItemId] = useState('');
  const [circleOnly, setCircleOnly] = useState(false);
  const action = useAction();
  const toast = useToast();
  const onShelf = new Set(circle.shelf.map((i) => i.id));
  const choices = (mine.data ?? []).filter((i) => !onShelf.has(i.id));
  const chosen = choices.find((i) => i.id === itemId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!itemId) return;
    const next = await action.run((key) =>
      api<CircleDetail>(`/circles/${circle.id}/items`, { body: { itemId, audience: circleOnly ? 'circles' : 'everyone' }, idempotencyKey: key }),
    );
    if (next) {
      setCircle(next);
      toast(`${chosen?.title ?? 'It'} is on the ${circle.name} shelf`);
      setOpen(false);
      setItemId('');
    }
  }

  if (!open)
    return (
      <div className="row gap wrap">
        <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setOpen(true)}>
          Share something you own
        </Button>
        <Link to={`/items/new?circle=${circle.id}`} className="btn btn-ghost">
          <span>List something new</span>
        </Link>
      </div>
    );

  return (
    <form className="action-panel" onSubmit={submit} aria-label="Share with this circle">
      <div className="action-panel-head">
        <h3>Share with {circle.name}</h3>
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      {mine.loading ? (
        <Spinner label="Loading your things" />
      ) : choices.length === 0 ? (
        <p className="muted">
          Everything you own is already here. <Link to={`/items/new?circle=${circle.id}`}>List something new</Link>.
        </p>
      ) : (
        <>
          <label className="field">
            <span className="field-label">Which of your things?</span>
            <select
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                const it = choices.find((i) => i.id === e.target.value);
                setCircleOnly(it?.audience === 'circles');
              }}
              required
            >
              <option value="" disabled>
                Choose an item
              </option>
              {choices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
            </select>
          </label>
          <AudienceChoice circleOnly={circleOnly} onChange={setCircleOnly} circleName={circle.name} />
          <InlineError error={action.error} />
          <Button type="submit" pending={action.pending} disabled={!itemId}>
            Put it on the shelf
          </Button>
        </>
      )}
    </form>
  );
}

// ---------------------------------------------------------------- members

function Members({ circle, setCircle, reload }: { circle: CircleDetail; setCircle: (c: CircleDetail) => void; reload: () => void }) {
  const { user } = useSession();
  const [confirming, setConfirming] = useState<string | null>(null);
  const organizer = circle.me.role === 'organizer';
  return (
    <section className="panel side-panel" aria-labelledby="members-h">
      <h2 id="members-h" className="panel-title">
        <ShieldCheck size={20} aria-hidden /> Members <span className="count">{circle.members.length}</span>
      </h2>
      <ul className="member-list">
        {circle.members.map((m) => {
          const me = m.person.id === user?.id;
          return (
            <li key={m.person.id} className="member">
              <div className="member-row">
                <Avatar person={m.person} size={36} />
                <span className="member-text">
                  <strong>
                    {me ? 'You' : m.person.name}
                    {m.role === 'organizer' && (
                      <span className="role-tag">
                        <Crown size={11} aria-hidden /> Organizer
                      </span>
                    )}
                  </strong>
                  <small>
                    {m.items > 0 ? `${plural(m.items, 'thing')} shared · ` : ''}joined {onDay(m.since)}
                  </small>
                </span>
              </div>
              {(me || organizer) && confirming !== m.person.id && (
                <MemberMenu circle={circle} member={m} me={me} setCircle={setCircle} onConfirm={() => setConfirming(m.person.id)} />
              )}
              {confirming === m.person.id && (
                <ConfirmDeparture circle={circle} person={m.person} self={me} onClose={() => setConfirming(null)} onDone={(next) => (next ? setCircle(next) : reload())} />
              )}
            </li>
          );
        })}
      </ul>
      <Invites circle={circle} setCircle={setCircle} />
    </section>
  );
}

function MemberMenu({ circle, member, me, setCircle, onConfirm }: { circle: CircleDetail; member: CircleMember; me: boolean; setCircle: (c: CircleDetail) => void; onConfirm: () => void }) {
  const promote = useAction();
  const toast = useToast();
  if (me)
    return (
      <span className="member-actions">
        <Button variant="quiet" icon={<LogOut size={14} />} onClick={onConfirm}>
          Leave circle
        </Button>
      </span>
    );
  return (
    <span className="member-actions">
      {member.role !== 'organizer' && (
        <Button
          variant="quiet"
          pending={promote.pending}
          aria-label={`Make ${member.person.firstName} an organizer`}
          onClick={async () => {
            const next = await promote.run((key) => api<CircleDetail>(`/circles/${circle.id}/members/${member.person.id}/organizer`, { body: {}, idempotencyKey: key }));
            if (next) {
              setCircle(next);
              toast(`${member.person.firstName} is now an organizer`);
            }
          }}
        >
          Make organizer
        </Button>
      )}
      <Button variant="quiet" icon={<UserMinus size={14} />} onClick={onConfirm} aria-label={`Remove ${member.person.firstName}`}>
        Remove
      </Button>
    </span>
  );
}

/**
 * Before anyone leaves or is removed, show exactly what changes — and, just as
 * importantly, what doesn't.
 */
function ConfirmDeparture({ circle, person, self, onClose, onDone }: { circle: CircleDetail; person: Person; self: boolean; onClose: () => void; onDone: (next?: CircleDetail) => void }) {
  const impact = useApi<MembershipImpact>(`/circles/${circle.id}/members/${person.id}/impact`);
  const action = useAction();
  const toast = useToast();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const name = person.firstName;
  const their = self ? 'your' : `${name}’s`;

  async function go() {
    if (self) {
      const ok = await action.run((key) => api(`/circles/${circle.id}/leave`, { body: {}, idempotencyKey: key }));
      if (ok) {
        refresh();
        toast(`You’ve left ${circle.name}. Your plans with its members still stand.`);
        navigate('/circles');
      }
      return;
    }
    const next = await action.run((key) => api<CircleDetail>(`/circles/${circle.id}/members/${person.id}/remove`, { body: {}, idempotencyKey: key }));
    if (next) {
      toast(`${name} is no longer in ${circle.name}. Existing bookings carry on.`);
      onDone(next);
    }
  }

  const data = impact.data;
  return (
    <div className="action-panel departure" role="group" aria-label={self ? 'Leave this circle' : `Remove ${name}`}>
      <div className="action-panel-head">
        <h3>{self ? `Leave ${circle.name}?` : `Remove ${name} from ${circle.name}?`}</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      {impact.error && <InlineError error={impact.error} />}
      {!data && !impact.error && <Spinner label="Checking what changes" />}
      {data && data.lastOrganizer && self ? (
        <p className="notice warn">You’re the only organizer. Make someone else an organizer first, so the circle is looked after.</p>
      ) : data ? (
        <>
          <div className="impact">
            <p className="impact-title stays">
              <CalendarCheck size={16} aria-hidden /> What stays the same
            </p>
            <ul>
              {data.borrowing.map((b) => (
                <li key={b.loanId}>
                  {b.commitment
                    ? `${self ? 'Your' : `${name}’s`} booking of ${b.owner.firstName}’s ${b.title} (${formatRange(b.startDate, b.endDate)}) still goes ahead.`
                    : `${self ? 'Your' : `${name}’s`} request for ${b.owner.firstName}’s ${b.title} (${formatRange(b.startDate, b.endDate)}) is still ${b.owner.firstName}’s to answer.`}
                </li>
              ))}
              {data.lending.map((l) => (
                <li key={l.loanId}>
                  {l.borrower.firstName}’s booking of {their} {l.title} ({formatRange(l.startDate, l.endDate)}) still goes ahead.
                </li>
              ))}
              <li>Everything already booked, borrowed or being returned carries on as planned.</li>
            </ul>
            <p className="impact-title changes">
              <UserMinus size={16} aria-hidden /> What changes
            </p>
            <ul>
              <li>
                {self ? 'You' : name} won’t be able to ask for {possessive(circle.name)} circle-only things.{' '}
                {self ? 'You can be invited back any time.' : `${name} can be invited back any time.`}
              </li>
              {data.items.map((i) => (
                <li key={i.id}>
                  {i.title} leaves this shelf
                  {i.becomesUnshared && ` — it’s circle-only and in no other circle, so nobody new can ask for it until ${self ? 'you share' : `${name} shares`} it again`}
                  .
                </li>
              ))}
            </ul>
          </div>
          <InlineError error={action.error} />
          <div className="row gap wrap">
            <Button variant="danger" pending={action.pending} onClick={go}>
              {self ? 'Leave circle' : `Remove ${name}`}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {self ? 'Stay' : 'Keep them'}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Invites({ circle, setCircle }: { circle: CircleDetail; setCircle: (c: CircleDetail) => void }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const people = useApi<Person[]>(open ? '/people' : null);
  const [who, setWho] = useState('');
  const invite = useAction();
  const withdraw = useAction();
  const toast = useToast();
  const taken = new Set([...circle.members, ...circle.invited].map((m) => m.person.id));
  const candidates = (people.data ?? []).filter((p) => !taken.has(p.id));
  const organizer = circle.me.role === 'organizer';

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!who) return;
    const next = await invite.run((key) => api<CircleDetail>(`/circles/${circle.id}/invitations`, { body: { userId: who }, idempotencyKey: key }));
    if (next) {
      const p = candidates.find((c) => c.id === who);
      setCircle(next);
      toast(`Invitation sent to ${p?.firstName ?? 'them'}`);
      setWho('');
      setOpen(false);
    }
  }

  return (
    <div className="invites">
      {circle.invited.length > 0 && (
        <>
          <h3 className="subhead">Invited</h3>
          <ul className="member-list">
            {circle.invited.map((m) => (
              <li key={m.person.id} className="member-row invited">
                <Avatar person={m.person} size={30} />
                <span className="member-text">
                  <strong>{m.person.name}</strong>
                  <small>
                    {m.invitedBy ? `Invited by ${m.invitedBy.id === user?.id ? 'you' : m.invitedBy.firstName}` : 'Invited'} · {onDay(m.since)}
                  </small>
                </span>
                {(organizer || m.invitedBy?.id === user?.id) && (
                  <Button
                    variant="quiet"
                    pending={withdraw.pending}
                    aria-label={`Withdraw ${m.person.firstName}’s invitation`}
                    onClick={async () => {
                      const next = await withdraw.run((key) => api<CircleDetail>(`/circles/${circle.id}/invitations/${m.person.id}/withdraw`, { body: {}, idempotencyKey: key }));
                      if (next) setCircle(next);
                    }}
                  >
                    Withdraw
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <InlineError error={withdraw.error} />
        </>
      )}
      {open ? (
        <form className="action-panel" onSubmit={send} aria-label="Send an invitation">
          <label className="field">
            <span className="field-label">Invite someone</span>
            <select value={who} onChange={(e) => setWho(e.target.value)} required>
              <option value="" disabled>
                {people.loading ? 'Loading…' : candidates.length ? 'Choose a person' : 'Everyone’s already here'}
              </option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.neighbourhood}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">They’ll join once they accept.</p>
          <InlineError error={invite.error} />
          <div className="row gap">
            <Button type="submit" pending={invite.pending} disabled={!who}>
              Send invitation
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" block icon={<UserPlus size={16} />} onClick={() => setOpen(true)}>
          Invite a friend
        </Button>
      )}
    </div>
  );
}

function Activity({ circle }: { circle: CircleDetail }) {
  const { user } = useSession();
  if (!circle.activity.length) return null;
  return (
    <section className="panel side-panel" aria-labelledby="act-h">
      <h2 id="act-h" className="panel-title">
        <History size={20} aria-hidden /> Circle history
      </h2>
      <ol className="timeline">
        {circle.activity.map((e) => (
          <li key={e.seq}>
            <span className="timeline-dot" aria-hidden />
            <span>{circleEventText(e, user?.id)}</span>
            <span className="muted small">{timeAgo(e.at)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
