import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle, CalendarClock, CalendarPlus, Check, ClipboardList, History, MessageCircle, Package, Scale, Send, Users, X,
} from 'lucide-react';
import { api, useAction, useApi } from '../api.ts';
import { useSession } from '../session.tsx';
import { useToast } from '../toast.tsx';
import { addDays, diffDays, formatDay, formatDayWeekday, formatMoment, formatRange, nights, onDay, plural, timeAgo } from '../format.ts';
import { Avatar, BackLink, Button, ErrorState, InlineError, ItemImage, Pill, Spinner } from '../components/ui.tsx';
import { ReportFields, emptyReport, toReport, type ReportDraft } from '../components/ReportFields.tsx';
import { STEPS, eventText, stage, statusLabel, stepIndex } from '../loanCopy.ts';
import { NotFound } from './NotFound.tsx';
import { CircleChip } from '../components/circles.tsx';
import type { Action, LoanDetail, Report } from '../types.ts';

export function LoanPage() {
  const { id } = useParams();
  const { data: loan, error, loading, reload, setData } = useApi<LoanDetail>(`/loans/${id}`, { refreshOnFocus: true });
  if (error?.status === 404) return <NotFound title="We couldn’t find that borrowing" message={error.message} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !loan) return <Spinner label="Loading" />;
  return <Loan loan={loan} setLoan={setData} reload={reload} />;
}

function Loan({ loan, setLoan, reload }: { loan: LoanDetail; setLoan: (l: LoanDetail) => void; reload: () => void }) {
  const isOwner = loan.role === 'owner';
  const other = isOwner ? loan.borrower : loan.owner;
  const label = statusLabel(loan);
  const ended = loan.status === 'declined' || loan.status === 'cancelled';

  return (
    <div className="loan-page">
      <BackLink to={isOwner ? '/lending' : '/borrowing'}>{isOwner ? 'Lending' : 'Borrowing'}</BackLink>
      <header className="loan-header">
        <Link to={`/items/${loan.item.id}`} className="loan-thumb" aria-label={`View ${loan.item.title}`}>
          <ItemImage url={loan.item.imageUrl} title={loan.item.title} category={loan.item.category} />
        </Link>
        <div className="loan-header-text">
          <p className="eyebrow">{isOwner ? `Lending to ${other.name}` : `Borrowing from ${other.name}`}</p>
          <h1>
            <Link to={`/items/${loan.item.id}`}>{loan.item.title}</Link>
          </h1>
          <p className="loan-dates">
            <CalendarClock size={18} aria-hidden /> {formatDayWeekday(loan.startDate)} → {formatDayWeekday(loan.endDate)}
            <span className="muted"> · {nights(loan.startDate, loan.endDate)}</span>
          </p>
        </div>
        <Pill tone={label.tone}>{label.text}</Pill>
      </header>

      {!ended && <Stepper status={loan.status} />}

      <div className="loan-layout">
        <div className="loan-main">
          <NextStep loan={loan} setLoan={setLoan} reload={reload} />
          <Evidence loan={loan} setLoan={setLoan} />
          <Conversation loan={loan} setLoan={setLoan} />
        </div>
        <aside className="loan-side">
          <Details loan={loan} />
          <Timeline loan={loan} />
        </aside>
      </div>
    </div>
  );
}

function Stepper({ status }: { status: string }) {
  const current = stepIndex(status);
  return (
    <ol className="stepper" aria-label="Progress">
      {STEPS.map((s, i) => {
        const state = i < current || status === 'returned' ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={s.key} className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="step-dot" aria-hidden>
              {state === 'done' ? <Check size={14} /> : i + 1}
            </span>
            <span className="step-label">{s.label}</span>
            <span className="sr-only">{state === 'done' ? ' (done)' : state === 'current' ? ' (now)' : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Shared mechanics for every write on this page. */
function useLoanAction(setLoan: (l: LoanDetail) => void) {
  const action = useAction();
  const toast = useToast();
  const { refresh } = useSession();
  async function post(path: string, body: unknown, message: string) {
    const next = await action.run((key) => api<LoanDetail>(path, { body, idempotencyKey: key }));
    if (next) {
      setLoan(next);
      toast(message);
      refresh();
      return true;
    }
    return false;
  }
  return { ...action, post };
}

function Panel({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="action-panel" role="group" aria-label={title}>
      <div className="action-panel-head">
        <h3>{title}</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      {children}
    </div>
  );
}

function NextStep({ loan, setLoan, reload }: { loan: LoanDetail; setLoan: (l: LoanDetail) => void; reload: () => void }) {
  const { today } = useSession();
  const s = stage(loan, today);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [report, setReport] = useState<ReportDraft>(emptyReport());
  const [withReport, setWithReport] = useState(false);
  const [agrees, setAgrees] = useState<boolean | null>(null);
  const [extDate, setExtDate] = useState('');
  const act = useLoanAction(setLoan);
  const a = (key: string): Action | undefined => loan.actions.find((x) => x.key === key);
  const owner = loan.owner.firstName;
  const borrower = loan.borrower.firstName;
  const base = `/loans/${loan.id}`;

  function openPanel(key: string) {
    setOpen(key);
    setNote('');
    setReport(emptyReport());
    setWithReport(key === 'mark_ready');
    setAgrees(null);
    setExtDate('');
    act.clearError();
  }
  const close = () => {
    setOpen(null);
    act.clearError();
  };
  const finish = (ok: boolean) => ok && setOpen(null);

  const conflictError = act.error?.code === 'booking_conflict' || act.error?.code === 'illegal_transition';
  const borrowerReturn = loan.reports.filter((r) => r.phase === 'return' && r.role === 'borrower').at(-1);
  const ext = loan.pendingExtension;
  const holding = loan.status !== 'requested';
  const overlaps = holding ? loan.overlapping.filter((o) => o.status === 'requested') : loan.overlapping;

  return (
    <section className={`next-step tone-${s.tone}`} aria-labelledby="next-h">
      {loan.overdue && (
        <p className="overdue-flag">
          <AlertTriangle size={16} aria-hidden /> Overdue · was due {formatDayWeekday(loan.endDate)}
        </p>
      )}
      <h2 id="next-h">{s.title}</h2>
      <p className="next-body">{s.body}</p>

      {loan.note && loan.status === 'requested' && (
        <blockquote className="quote">
          <Avatar person={loan.borrower} size={26} />
          <span>“{loan.note}”</span>
        </blockquote>
      )}

      {loan.role === 'owner' && loan.status === 'requested' && loan.via && !loan.via.borrowerStillMember && (
        <p className="notice">
          <Users size={18} aria-hidden />
          <span>
            {borrower} asked through {loan.via.name} and has since {loan.via.borrowerLeft?.how === 'removed' ? 'been removed from' : 'left'} the circle. The
            request was made while they were a member, so it’s still yours to approve or decline.
          </span>
        </p>
      )}

      {/* Owner: what else wants these dates */}
      {overlaps.length > 0 && (
        <div className="overlap-box">
          <p className="overlap-title">
            <Scale size={16} aria-hidden /> {holding ? 'Others are still waiting on these dates' : 'Other people want overlapping dates'}
          </p>
          <ul>
            {overlaps.map((o) => (
              <li key={o.id}>
                <Link to={`/loans/${o.id}`}>
                  {o.borrower.firstName} · {formatRange(o.startDate, o.endDate)} ·{' '}
                  {o.status === 'requested' ? 'waiting for you' : 'confirmed'}
                </Link>
              </li>
            ))}
          </ul>
          <p className="muted small">
            {holding
              ? 'These overlap the dates you’ve reserved, so they can’t be approved. A kind decline lets them make other plans.'
              : 'Only one person can have it at a time — approving one means the others can’t be approved for those days.'}
          </p>
        </div>
      )}

      {/* Extension waiting on the owner */}
      {ext && a('accept_extension') && (
        <div className="ext-box">
          <p className="ext-title">
            <CalendarPlus size={18} aria-hidden /> {borrower} asked to keep it until <strong>{formatDayWeekday(ext.newEndDate)}</strong>{' '}
            <span className="muted">(+{plural(diffDays(ext.fromEndDate, ext.newEndDate), 'day')})</span>
          </p>
          {ext.note && <p className="quote-inline">“{ext.note}”</p>}
          {!a('accept_extension')!.enabled && (
            <p className="notice warn">
              <AlertTriangle size={16} aria-hidden /> {a('accept_extension')!.reason} You can decline with a kind note.
            </p>
          )}
          {open !== 'decline_extension' && (
            <div className="row gap wrap">
              <Button
                disabled={!a('accept_extension')!.enabled}
                pending={act.pending && open === null}
                onClick={async () => finish(await act.post(`/extensions/${ext.id}/accept`, {}, `${borrower} can keep it until ${formatDay(ext.newEndDate)}`))}
              >
                Yes, extend it
              </Button>
              <Button variant="secondary" onClick={() => openPanel('decline_extension')}>
                Say no…
              </Button>
            </div>
          )}
        </div>
      )}
      {ext && a('withdraw_extension') && (
        <div className="ext-box">
          <p className="ext-title">
            <CalendarPlus size={18} aria-hidden /> You asked to keep it until <strong>{formatDayWeekday(ext.newEndDate)}</strong> — waiting for {owner}.
          </p>
          <Button
            variant="quiet"
            pending={act.pending}
            onClick={() => act.post(`/extensions/${ext.id}/withdraw`, {}, 'Extension request withdrawn')}
          >
            Withdraw request
          </Button>
        </div>
      )}

      {/* Primary actions */}
      {open === null && (
        <div className="next-actions">
          {a('approve') && (
            <>
              {!a('approve')!.enabled && (
                <p className="notice warn">
                  <AlertTriangle size={16} aria-hidden /> {a('approve')!.reason}
                </p>
              )}
              <Button
                icon={<Check size={18} />}
                disabled={!a('approve')!.enabled}
                pending={act.pending}
                onClick={() => act.post(`${base}/approve`, {}, `Approved — ${borrower} has it reserved`)}
              >
                Approve
              </Button>
            </>
          )}
          {a('decline') && (
            <Button variant="secondary" onClick={() => openPanel('decline')}>
              Decline…
            </Button>
          )}
          {a('mark_ready') && (
            <Button icon={<Package size={18} />} disabled={!a('mark_ready')!.enabled} title={a('mark_ready')!.reason} onClick={() => openPanel('mark_ready')}>
              Mark ready for pickup
            </Button>
          )}
          {a('confirm_pickup') && (
            <Button icon={<Check size={18} />} disabled={!a('confirm_pickup')!.enabled} title={a('confirm_pickup')!.reason} onClick={() => openPanel('confirm_pickup')}>
              I’ve picked it up
            </Button>
          )}
          {a('start_return') && (
            <Button icon={<Package size={18} />} onClick={() => openPanel('start_return')}>
              Start return
            </Button>
          )}
          {a('confirm_return') && (
            <Button icon={<Check size={18} />} onClick={() => openPanel('confirm_return')} variant={loan.status === 'returning' ? 'primary' : 'secondary'}>
              {loan.status === 'returning' ? 'Confirm it’s back' : 'It’s already back with me'}
            </Button>
          )}
          {a('propose_extension') && (
            <Button variant="secondary" icon={<CalendarPlus size={18} />} onClick={() => openPanel('propose_extension')}>
              Ask for more time
            </Button>
          )}
          {a('cancel') && (
            <Button variant="quiet" onClick={() => openPanel('cancel')}>
              {loan.status === 'requested' ? 'Cancel request' : 'Cancel reservation'}
            </Button>
          )}
        </div>
      )}

      {open === 'decline' && (
        <Panel title="Decline this request" onClose={close}>
          <label className="field">
            <span className="field-label">
              A note for {borrower} <span className="optional">optional</span>
            </span>
            <textarea rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sorry, I need it myself that weekend!" />
          </label>
          <InlineError error={act.error} />
          <div className="row gap">
            <Button variant="danger" pending={act.pending} onClick={async () => finish(await act.post(`${base}/decline`, { note }, 'Request declined'))}>
              Decline request
            </Button>
            <Button variant="ghost" onClick={close}>
              Keep it open
            </Button>
          </div>
        </Panel>
      )}

      {open === 'decline_extension' && ext && (
        <Panel title="Say no to the extension" onClose={close}>
          <label className="field">
            <span className="field-label">
              A note for {borrower} <span className="optional">optional</span>
            </span>
            <textarea rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Someone else has it booked right after — sorry!" />
          </label>
          <InlineError error={act.error} />
          <div className="row gap">
            <Button variant="danger" pending={act.pending} onClick={async () => finish(await act.post(`/extensions/${ext.id}/decline`, { note }, 'Extension declined — the due date stays the same'))}>
              Decline extension
            </Button>
            <Button variant="ghost" onClick={close}>
              Back
            </Button>
          </div>
        </Panel>
      )}

      {open === 'mark_ready' && (
        <Panel title="Ready for pickup" onClose={close}>
          <label className="field">
            <span className="field-label">
              Pickup details for {borrower} <span className="optional">optional</span>
            </span>
            <textarea rows={2} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder={loan.item.pickupNotes || 'e.g. It’s on the porch by the blue bin.'} />
          </label>
          <label className="check">
            <input type="checkbox" checked={withReport} onChange={(e) => setWithReport(e.target.checked)} />
            <span>Record its condition before it goes out (recommended)</span>
          </label>
          {withReport && <ReportFields value={report} onChange={setReport} legend="How is it as it goes out?" />}
          <InlineError error={act.error} />
          <Button
            pending={act.pending}
            disabled={withReport && !report.condition}
            onClick={async () =>
              finish(await act.post(`${base}/ready`, { note, report: withReport ? toReport(report) : undefined }, `${borrower} will see it’s ready`))
            }
          >
            Mark ready
          </Button>
        </Panel>
      )}

      {open === 'confirm_pickup' && (
        <Panel title="Got it?" onClose={close}>
          <p className="muted">Confirming tells {owner} it’s with you. It’s due back {formatDayWeekday(loan.endDate)}.</p>
          <label className="check">
            <input type="checkbox" checked={withReport} onChange={(e) => setWithReport(e.target.checked)} />
            <span>Note its condition at pickup (handy if anything was already worn)</span>
          </label>
          {withReport && <ReportFields value={report} onChange={setReport} legend="How is it as you receive it?" />}
          <InlineError error={act.error} />
          <Button
            pending={act.pending}
            disabled={withReport && !report.condition}
            onClick={async () => finish(await act.post(`${base}/pickup`, { report: withReport ? toReport(report) : undefined }, 'Enjoy! Pickup confirmed'))}
          >
            Yes, I have it
          </Button>
        </Panel>
      )}

      {open === 'start_return' && (
        <Panel title={`Returning it to ${owner}`} onClose={close}>
          <p className="muted">Describe how it’s coming back. {owner} will add their own notes when it’s home — both are kept.</p>
          <ReportFields value={report} onChange={setReport} legend="How is it as you return it?" />
          <InlineError error={act.error} />
          <Button pending={act.pending} disabled={!report.condition} onClick={async () => finish(await act.post(`${base}/return`, { report: toReport(report) }, `Thanks! ${owner} will confirm it’s back`))}>
            Start return
          </Button>
          {!report.condition && <p className="muted small">Choose how it looks to continue.</p>}
        </Panel>
      )}

      {open === 'confirm_return' && (
        <Panel title="Is it back home?" onClose={close}>
          {borrowerReturn ? (
            <>
              <p className="field-label">{borrower} said:</p>
              <ReportCard report={borrowerReturn} compact />
              <fieldset className="agree-picker">
                <legend className="field-label">Does that match what you see?</legend>
                <label className={`agree-option ${agrees === true ? 'on' : ''}`}>
                  <input type="radio" name="agree" checked={agrees === true} onChange={() => setAgrees(true)} />
                  <span>Yes, that matches</span>
                </label>
                <label className={`agree-option ${agrees === false ? 'on' : ''}`}>
                  <input type="radio" name="agree" checked={agrees === false} onChange={() => setAgrees(false)} />
                  <span>I see it differently</span>
                </label>
              </fieldset>
            </>
          ) : (
            <p className="muted">{borrower} hasn’t described the return. You can confirm it’s back and add your own notes.</p>
          )}
          <ReportFields
            value={report}
            onChange={setReport}
            legend="How does it look to you?"
            notesLabel={agrees === false ? 'What’s different?' : 'Your notes'}
            notesPlaceholder={agrees === false ? 'Describe what you noticed — it’s kept alongside their account' : undefined}
          />
          <InlineError error={act.error} />
          <Button
            pending={act.pending}
            disabled={!report.condition || (!!borrowerReturn && agrees === null)}
            onClick={async () =>
              finish(
                await act.post(
                  `${base}/confirm-return`,
                  { report: { ...toReport(report), agrees: borrowerReturn ? agrees : undefined } },
                  'Welcome home! The loan is complete',
                ),
              )
            }
          >
            Confirm it’s back
          </Button>
        </Panel>
      )}

      {open === 'propose_extension' && (
        <Panel title="Ask for more time" onClose={close}>
          <label className="field">
            <span className="field-label">Keep it until</span>
            <input
              type="date"
              value={extDate}
              min={addDays(loan.endDate, 1) > today ? addDays(loan.endDate, 1) : today}
              onChange={(e) => {
                setExtDate(e.target.value);
                act.clearError();
              }}
            />
            {extDate && <span className="muted small">That’s {plural(diffDays(loan.endDate, extDate), 'more day')} than now.</span>}
          </label>
          <label className="field">
            <span className="field-label">
              Why? <span className="optional">optional</span>
            </span>
            <textarea rows={2} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A sentence goes a long way" />
          </label>
          <InlineError error={act.error} />
          {act.error?.details?.latestPossible && (
            <Button variant="secondary" onClick={() => setExtDate(act.error!.details.latestPossible)}>
              Use {formatDayWeekday(act.error.details.latestPossible)} instead
            </Button>
          )}
          <Button
            pending={act.pending}
            disabled={!extDate}
            onClick={async () => finish(await act.post(`${base}/extensions`, { endDate: extDate, note }, `Asked ${owner} for more time`))}
          >
            Ask {owner}
          </Button>
          <p className="muted small">Your current due date stays until {owner} says yes.</p>
        </Panel>
      )}

      {open === 'cancel' && (
        <Panel title={loan.status === 'requested' ? 'Cancel your request?' : 'Cancel this reservation?'} onClose={close}>
          <label className="field">
            <span className="field-label">
              Let {loan.role === 'owner' ? borrower : owner} know why <span className="optional">optional</span>
            </span>
            <textarea rows={2} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Plans changed…" />
          </label>
          <InlineError error={act.error} />
          <div className="row gap">
            <Button variant="danger" pending={act.pending} onClick={async () => finish(await act.post(`${base}/cancel`, { reason: note }, 'Cancelled — those dates are free again'))}>
              Yes, cancel
            </Button>
            <Button variant="ghost" onClick={close}>
              Keep it
            </Button>
          </div>
        </Panel>
      )}

      {open === null && <InlineError error={act.error} />}
      {open === null && conflictError && (
        <Button variant="quiet" onClick={reload}>
          Refresh to see the latest
        </Button>
      )}
    </section>
  );
}

const CONDITION_TONE: Record<string, string> = {
  like_new: 'good',
  good: 'good',
  worn: 'neutral',
  damaged: 'bad',
  missing_parts: 'bad',
};

function ReportCard({ report, compact }: { report: Report; compact?: boolean }) {
  const { config } = useSession();
  const label = config?.conditions.find((c) => c.value === report.condition)?.label ?? report.condition;
  return (
    <article className={`report ${compact ? 'report-compact' : ''}`}>
      <header className="report-head">
        <Avatar person={report.author} size={30} />
        <div>
          <p className="report-author">
            {report.author.name} <span className="role-tag">{report.role === 'owner' ? 'Owner' : 'Borrower'}</span>
          </p>
          <p className="muted small">{formatMoment(report.at)}</p>
        </div>
      </header>
      <p className="report-condition">
        <Pill tone={CONDITION_TONE[report.condition] as any}>{label}</Pill>
        {report.agrees === true && <span className="agree-tag">Matches the borrower’s notes</span>}
        {report.agrees === false && <span className="agree-tag differ">Sees it differently</span>}
      </p>
      {report.notes && <p className="report-notes">{report.notes}</p>}
      {report.photos.length > 0 && (
        <div className="report-photos">
          {report.photos.map((p, i) => (
            <a key={p} href={p} target="_blank" rel="noreferrer">
              <img src={p} alt={`Condition photo ${i + 1} from ${report.author.firstName}`} loading="lazy" />
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

function Evidence({ loan, setLoan }: { loan: LoanDetail; setLoan: (l: LoanDetail) => void }) {
  const [adding, setAdding] = useState(false);
  const [report, setReport] = useState<ReportDraft>(emptyReport());
  const act = useLoanAction(setLoan);
  const canAdd = loan.actions.some((a) => a.key === 'add_followup');
  if (loan.reports.length === 0 && !canAdd) return null;
  const groups = [
    { phase: 'handoff', title: 'When it went out' },
    { phase: 'return', title: 'When it came back' },
    { phase: 'followup', title: 'Added afterwards' },
  ];
  return (
    <section className="panel" aria-labelledby="ev-h">
      <h2 id="ev-h" className="panel-title">
        <ClipboardList size={20} aria-hidden /> Condition notes
      </h2>
      <p className="muted small">Each person’s notes are kept exactly as they wrote them, side by side. Nothing is ever edited or overwritten.</p>
      {loan.disputed && (
        <p className="notice">
          <Scale size={16} aria-hidden /> {loan.owner.firstName} and {loan.borrower.firstName} described the return differently. Both accounts are preserved below.
        </p>
      )}
      {loan.reports.length === 0 && <p className="muted">No condition notes yet.</p>}
      {groups.map((g) => {
        const rs = loan.reports.filter((r) => r.phase === g.phase);
        if (!rs.length) return null;
        return (
          <div key={g.phase} className="report-group">
            <h3 className="subhead">{g.title}</h3>
            <div className="report-grid">
              {rs.map((r) => (
                <ReportCard key={r.id} report={r} />
              ))}
            </div>
          </div>
        );
      })}
      {canAdd &&
        (adding ? (
          <Panel title="Add to the record" onClose={() => setAdding(false)}>
            <p className="muted small">This is added as a new note with your name on it. Earlier notes stay exactly as they are.</p>
            <ReportFields value={report} onChange={setReport} legend="How do you see its condition?" />
            <InlineError error={act.error} />
            <Button
              pending={act.pending}
              disabled={!report.condition}
              onClick={async () => {
                if (await act.post(`/loans/${loan.id}/followup`, { report: toReport(report) }, 'Your note was added')) {
                  setAdding(false);
                  setReport(emptyReport());
                }
              }}
            >
              Add note
            </Button>
          </Panel>
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add a condition note
          </Button>
        ))}
    </section>
  );
}

function Conversation({ loan, setLoan }: { loan: LoanDetail; setLoan: (l: LoanDetail) => void }) {
  const { user } = useSession();
  const [body, setBody] = useState('');
  const act = useLoanAction(setLoan);
  const other = loan.role === 'owner' ? loan.borrower : loan.owner;
  return (
    <section className="panel" aria-labelledby="msg-h">
      <h2 id="msg-h" className="panel-title">
        <MessageCircle size={20} aria-hidden /> Messages with {other.firstName}
      </h2>
      {loan.messages.length === 0 ? (
        <p className="muted">Sort out pickup times and handoff details here.</p>
      ) : (
        <ol className="messages">
          {loan.messages.map((m) => (
            <li key={m.id} className={`message ${m.author.id === user?.id ? 'mine' : ''}`}>
              <Avatar person={m.author} size={28} />
              <div className="bubble">
                <p>{m.body}</p>
                <span className="muted small">
                  {m.author.id === user?.id ? 'You' : m.author.firstName} · {timeAgo(m.at)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <form
        className="composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          if (await act.post(`/loans/${loan.id}/messages`, { body }, `Sent to ${other.firstName}`)) setBody('');
        }}
      >
        <label className="sr-only" htmlFor="composer">
          Message {other.firstName}
        </label>
        <textarea
          id="composer"
          rows={1}
          maxLength={1200}
          value={body}
          placeholder={`Message ${other.firstName}…`}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }
          }}
        />
        <Button type="submit" pending={act.pending} disabled={!body.trim()} icon={<Send size={16} />} aria-label="Send message">
          Send
        </Button>
      </form>
      <InlineError error={act.error} />
    </section>
  );
}

function Details({ loan }: { loan: LoanDetail }) {
  const extended = loan.endDate !== loan.originalEndDate;
  return (
    <section className="panel side-panel" aria-labelledby="det-h">
      <h2 id="det-h" className="panel-title">Details</h2>
      <dl className="details">
        <div>
          <dt>Pickup</dt>
          <dd>{formatDayWeekday(loan.startDate)}</dd>
        </div>
        <div>
          <dt>Due back</dt>
          <dd>
            {formatDayWeekday(loan.endDate)}
            {extended && <span className="muted small"> (extended from {formatDay(loan.originalEndDate)})</span>}
            {loan.overdue && <Pill tone="warn">{plural(loan.daysLate, 'day')} late</Pill>}
          </dd>
        </div>
        <div>
          <dt>{loan.role === 'owner' ? 'Borrower' : 'Owner'}</dt>
          <dd className="row gap-s">
            <Avatar person={loan.role === 'owner' ? loan.borrower : loan.owner} size={24} />
            {(loan.role === 'owner' ? loan.borrower : loan.owner).name}
          </dd>
        </div>
        {loan.item.pickupNotes && (
          <div>
            <dt>Pickup & return</dt>
            <dd>{loan.item.pickupNotes}</dd>
          </div>
        )}
        {loan.item.careNotes && (
          <div>
            <dt>Care</dt>
            <dd>{loan.item.careNotes}</dd>
          </div>
        )}
        {loan.via && (
          <div>
            <dt>Shared through</dt>
            <dd>
              <CircleChip circle={loan.via} link={loan.via.borrowerStillMember || loan.role === 'owner'} />
            </dd>
            {!loan.via.borrowerStillMember && loan.via.borrowerLeft && (
              <dd className="muted small">
                {loan.role === 'borrower' ? 'You' : loan.borrower.firstName}{' '}
                {loan.via.borrowerLeft.how === 'removed' ? 'stopped being a member' : 'left the circle'} on {onDay(loan.via.borrowerLeft.at)}. This
                was arranged while {loan.role === 'borrower' ? 'you were' : `${loan.borrower.firstName} was`} a member, so it carries on as agreed.
              </dd>
            )}
          </div>
        )}
        {loan.note && (
          <div>
            <dt>Request note</dt>
            <dd>“{loan.note}”</dd>
          </div>
        )}
      </dl>
      <p className="muted small">Dates are whole days in the community’s time zone. The item is due back by the end of the due date.</p>
    </section>
  );
}

function Timeline({ loan }: { loan: LoanDetail }) {
  const { user } = useSession();
  return (
    <section className="panel side-panel" aria-labelledby="hist-h">
      <h2 id="hist-h" className="panel-title">
        <History size={20} aria-hidden /> History
      </h2>
      <ol className="timeline">
        {loan.events.map((e) => {
          const name = e.actor ? (e.actor.id === user?.id ? 'You' : e.actor.firstName) : 'BorrowBox';
          const message = e.detail.message || e.detail.reason || e.detail.note;
          return (
            <li key={e.seq}>
              <span className="timeline-dot" aria-hidden />
              <p>{eventText(e.type, e.detail, name, loan)}</p>
              {message && e.type !== 'requested' && <p className="timeline-quote">“{message}”</p>}
              <p className="muted small">
                <time dateTime={e.at}>{formatMoment(e.at)}</time>
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
