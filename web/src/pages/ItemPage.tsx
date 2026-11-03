import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, Clock, Eye, EyeOff, Hand, MapPin, Pencil, Sparkles } from 'lucide-react';
import { api, useAction, useApi } from '../api.ts';
import { useSession } from '../session.tsx';
import { useToast } from '../toast.tsx';
import { formatRange, memberSince, nights, plural } from '../format.ts';
import { DateRangePicker, type Range } from '../components/DateRangePicker.tsx';
import { Avatar, BackLink, Button, ErrorState, InlineError, ItemImage, Pill, Spinner } from '../components/ui.tsx';
import { availabilityText } from '../components/ItemCard.tsx';
import { statusLabel } from '../loanCopy.ts';
import { NotFound } from './NotFound.tsx';
import type { ItemDetail, LoanDetail } from '../types.ts';

export function ItemPage() {
  const { id } = useParams();
  const { today } = useSession();
  const { data: item, error, loading, reload, setData } = useApi<ItemDetail>(`/items/${id}`, { refreshOnFocus: true });

  if (error?.status === 404)
    return <NotFound title={error.code === 'item_resting' ? 'This item is resting' : 'Item not found'} message={error.message} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !item) return <Spinner label="Loading item" />;

  const avail = availabilityText(item, today);
  const blocked = item.bookings.map((b) => ({ startDate: b.startDate, endDate: b.endDate, mine: b.mine }));

  return (
    <div className="item-page">
      <BackLink to={item.isMine ? '/lending' : '/'}>{item.isMine ? 'Your lending' : 'All items'}</BackLink>
      <div className="item-layout">
        <div className="item-media">
          <ItemImage url={item.imageUrl} title={item.title} category={item.category} className="item-hero-img" />
        </div>
        <div className="item-info">
          <p className="eyebrow">{item.category}</p>
          <h1 className="item-title">{item.title}</h1>
          <div className="item-badges">
            <span className={`avail avail-${avail.tone} avail-inline`}>
              <i aria-hidden /> {avail.text}
            </span>
            {item.hidden && <Pill tone="neutral"><EyeOff size={14} aria-hidden /> Hidden from the catalog</Pill>}
          </div>
          {item.description && <p className="item-desc">{item.description}</p>}

          <div className="owner-card">
            <Avatar person={item.owner} size={48} />
            <div>
              <p className="owner-name">{item.isMine ? 'You’re lending this' : `Lent by ${item.owner.name}`}</p>
              <p className="muted small">
                <MapPin size={14} aria-hidden /> {item.owner.neighbourhood} · Member since {memberSince(item.owner.memberSince)}
              </p>
              {!item.isMine && item.owner.bio && <p className="owner-bio">“{item.owner.bio}”</p>}
            </div>
          </div>

          <section className="rules" aria-labelledby="rules-h">
            <h2 id="rules-h">Borrowing rules</h2>
            <ul>
              <li>
                <Clock size={18} aria-hidden />
                <span>
                  <strong>Up to {plural(item.maxDays, 'day')} at a time</strong>
                </span>
              </li>
              {item.pickupNotes && (
                <li>
                  <Hand size={18} aria-hidden />
                  <span>
                    <strong>Pickup & return</strong> {item.pickupNotes}
                  </span>
                </li>
              )}
              {item.careNotes && (
                <li>
                  <Sparkles size={18} aria-hidden />
                  <span>
                    <strong>Care</strong> {item.careNotes}
                  </span>
                </li>
              )}
            </ul>
          </section>
        </div>
      </div>

      {item.isMine ? (
        <OwnerPanel item={item} onChange={setData} blocked={blocked} />
      ) : (
        <BorrowPanel item={item} blocked={blocked} />
      )}
    </div>
  );
}

function BorrowPanel({ item, blocked }: { item: ItemDetail; blocked: { startDate: string; endDate: string; mine: boolean }[] }) {
  const { today, refresh } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [range, setRange] = useState<Range>({ start: null, end: null });
  const [note, setNote] = useState('');
  const action = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!range.start) return;
    const end = range.end ?? range.start;
    const loan = await action.run((key) =>
      api<LoanDetail>('/loans', { body: { itemId: item.id, startDate: range.start, endDate: end, note }, idempotencyKey: key }),
    );
    if (loan) {
      toast(`Request sent to ${item.owner.firstName}`);
      refresh();
      navigate(`/loans/${loan.id}`);
    }
  }

  return (
    <section className="panel request-panel" aria-labelledby="req-h">
      <div className="panel-head">
        <h2 id="req-h">
          <CalendarDays size={20} aria-hidden /> {item.canRequest.ok ? 'Choose your dates' : 'Availability'}
        </h2>
        {item.myOpenLoans.length > 0 && (
          <div className="my-requests">
            {item.myOpenLoans.map((l) => (
              <Link key={l.id} to={`/loans/${l.id}`} className="my-request">
                Your {l.status === 'requested' ? 'request' : 'booking'}: {formatRange(l.startDate, l.endDate)} ·{' '}
                {statusLabel({ ...(l as any), role: 'borrower', owner: item.owner, borrower: item.owner, datesPassed: l.endDate < today } as any).text} →
              </Link>
            ))}
          </div>
        )}
      </div>
      {!item.canRequest.ok && (
        <p className="notice">
          <EyeOff size={18} aria-hidden /> {item.canRequest.reason} Existing bookings still go ahead.
        </p>
      )}
      <div className="request-grid">
        <DateRangePicker
          today={today}
          blocked={blocked}
          maxDays={item.maxDays}
          value={range}
          onChange={(r) => {
            setRange(r);
            action.clearError();
          }}
          readOnly={!item.canRequest.ok}
        />
        {item.canRequest.ok && (
          <form className="request-form" onSubmit={submit}>
            <div className="summary-box">
              {range.start ? (
                <>
                  <p className="summary-dates">{formatRange(range.start, range.end ?? range.start)}</p>
                  <p className="muted small">
                    {nights(range.start, range.end ?? range.start)}
                    {!range.end && ' · tap another day for a longer loan'}
                  </p>
                </>
              ) : (
                <p className="muted">Pick a pickup day on the calendar. Up to {plural(item.maxDays, 'day')}.</p>
              )}
            </div>
            <label className="field">
              <span className="field-label">
                Note to {item.owner.firstName} <span className="optional">optional</span>
              </span>
              <textarea
                rows={3}
                maxLength={600}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What’s it for? When could you pick it up?"
              />
            </label>
            <InlineError error={action.error} />
            <Button type="submit" block pending={action.pending} disabled={!range.start}>
              {range.start ? `Ask ${item.owner.firstName} to borrow it` : 'Choose dates first'}
            </Button>
            <p className="muted small center">Nothing is booked until {item.owner.firstName} approves.</p>
          </form>
        )}
      </div>
    </section>
  );
}

function OwnerPanel({ item, onChange, blocked }: { item: ItemDetail; onChange: (i: ItemDetail) => void; blocked: { startDate: string; endDate: string; mine: boolean }[] }) {
  const { today } = useSession();
  const toast = useToast();
  const action = useAction();

  async function toggleHidden() {
    const next = await action.run((key) =>
      api<ItemDetail>(`/items/${item.id}/visibility`, { body: { hidden: !item.hidden }, idempotencyKey: key }),
    );
    if (next) {
      onChange(next);
      toast(next.hidden ? 'Hidden from the catalog. Existing bookings are unchanged.' : 'Back in the catalog — people can request it again.');
    }
  }

  return (
    <section className="panel owner-panel" aria-labelledby="own-h">
      <div className="panel-head">
        <h2 id="own-h">Your item</h2>
        <div className="row gap">
          <Link className="btn btn-secondary" to={`/items/${item.id}/edit`}>
            <Pencil size={16} aria-hidden />
            <span>Edit</span>
          </Link>
          <Button variant="secondary" icon={item.hidden ? <Eye size={16} /> : <EyeOff size={16} />} pending={action.pending} onClick={toggleHidden}>
            {item.hidden ? 'Show in catalog' : 'Hide from catalog'}
          </Button>
        </div>
      </div>
      <InlineError error={action.error} />
      <p className="muted small">
        {item.hidden
          ? 'Hidden: nobody new can request it. Reservations already made carry on as planned.'
          : 'Hiding pauses new requests without cancelling anything already booked.'}
      </p>
      <div className="owner-grid">
        <div>
          <h3 className="subhead">Requests waiting for you</h3>
          {item.pendingRequests.length === 0 ? (
            <p className="muted">No new requests right now.</p>
          ) : (
            <ul className="mini-list">
              {item.pendingRequests.map((r) => (
                <li key={r.id}>
                  <Link to={`/loans/${r.id}`} className="mini-row">
                    <Avatar person={r.borrower} size={30} />
                    <span>
                      <strong>{r.borrower.firstName}</strong> · {formatRange(r.startDate, r.endDate)}
                      {r.note && <small>“{r.note}”</small>}
                    </span>
                    <span aria-hidden>→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <h3 className="subhead">Booked</h3>
          {item.bookings.length === 0 ? (
            <p className="muted">Nothing booked.</p>
          ) : (
            <ul className="mini-list">
              {item.bookings.map((b) => (
                <li key={b.loanId}>
                  <Link to={`/loans/${b.loanId}`} className="mini-row">
                    {b.borrower && <Avatar person={b.borrower} size={30} />}
                    <span>
                      <strong>{b.borrower?.firstName}</strong> · {formatRange(b.startDate, b.endDate)}
                      <small>{b.status === 'borrowed' || b.status === 'returning' ? (b.endDate < today ? 'Has it now · running late' : 'Has it now') : 'Upcoming'}</small>
                    </span>
                    <span aria-hidden>→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DateRangePicker today={today} blocked={blocked.map((b) => ({ ...b, mine: false }))} readOnly />
      </div>
    </section>
  );
}
