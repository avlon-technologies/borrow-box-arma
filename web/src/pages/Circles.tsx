import { Link, useNavigate } from 'react-router-dom';
import { Lock, Plus, Users } from 'lucide-react';
import { api, useAction, useApi } from '../api.ts';
import { useSession } from '../session.tsx';
import { useToast } from '../toast.tsx';
import { plural, timeAgo } from '../format.ts';
import { Button, EmptyState, ErrorState, InlineError, Spinner } from '../components/ui.tsx';
import { AvatarStack, CircleMark } from '../components/circles.tsx';
import type { CircleInvitation, CircleSummary } from '../types.ts';

export function Circles() {
  const { data, error, loading, reload } = useApi<{ circles: CircleSummary[]; invitations: CircleInvitation[] }>('/circles', {
    refreshOnFocus: true,
  });
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <Spinner label="Loading circles" />;
  const { circles, invitations } = data;

  return (
    <div className="dash">
      <header className="page-head row between wrap">
        <div>
          <h1>Circles</h1>
          <p className="muted">Small groups of friends who share a shelf — and can keep some things just between them.</p>
        </div>
        <Link to="/circles/new" className="btn btn-primary">
          <Plus size={18} aria-hidden />
          <span>Start a circle</span>
        </Link>
      </header>

      {invitations.length > 0 && (
        <section className="loan-section" aria-label="Invitations">
          <h2 className="section-title">
            Invitations <span className="count">{invitations.length}</span>
          </h2>
          <div className="circle-list">
            {invitations.map((c) => (
              <Invitation key={c.id} circle={c} onDone={reload} />
            ))}
          </div>
        </section>
      )}

      <section className="loan-section" aria-label="Your circles">
        {invitations.length > 0 && <h2 className="section-title">Your circles</h2>}
        {circles.length === 0 ? (
          <EmptyState
            icon={<Users size={28} />}
            title="No circles yet"
            action={<Link to="/circles/new" className="btn btn-primary"><span>Start your first circle</span></Link>}
          >
            Start one for your street, your climbing crew or your book club. Invite friends, put things on a shared
            shelf, and choose whether each one is for everybody or just the circle.
          </EmptyState>
        ) : (
          <div className="circle-list">
            {circles.map((c) => (
              <Link key={c.id} to={`/circles/${c.id}`} className="circle-card">
                <CircleMark circle={c} size={56} />
                <span className="circle-card-text">
                  <strong className="circle-card-name">{c.name}</strong>
                  {c.description && <span className="circle-card-desc">{c.description}</span>}
                  <span className="circle-card-meta">
                    <AvatarStack people={c.members} size={24} />
                    {plural(c.memberCount, 'member')} · {plural(c.itemCount, 'thing')} on the shelf
                    {c.myRole === 'organizer' && <span className="role-tag">Organizer</span>}
                  </span>
                </span>
                <span aria-hidden className="circle-card-go">→</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <aside className="explainer" aria-label="How circles work">
        <h2 className="panel-title"><Lock size={18} aria-hidden /> How circles work</h2>
        <ul>
          <li><strong>Your shelf, your call.</strong> Share anything with a circle. Leave it open to everyone, or keep it for circle members only.</li>
          <li><strong>Plans stay plans.</strong> If someone leaves or is removed, anything they’ve already booked still goes ahead. They just can’t ask for circle-only things any more.</li>
          <li><strong>Anyone can invite.</strong> Organizers look after the circle and can remove people if they need to.</li>
        </ul>
      </aside>
    </div>
  );
}

function Invitation({ circle, onDone }: { circle: CircleInvitation; onDone: () => void }) {
  const join = useAction();
  const decline = useAction();
  const toast = useToast();
  const { refresh } = useSession();
  const navigate = useNavigate();

  async function answer(accept: boolean) {
    const act = accept ? join : decline;
    const ok = await act.run((key) => api(`/circles/${circle.id}/${accept ? 'join' : 'decline'}`, { body: {}, idempotencyKey: key }));
    if (!ok) return;
    refresh();
    if (accept) {
      toast(`Welcome to ${circle.name}`);
      navigate(`/circles/${circle.id}`);
    } else {
      toast('Invitation declined');
      onDone();
    }
  }

  return (
    <article className="circle-card invitation">
      <CircleMark circle={circle} size={56} />
      <div className="circle-card-text">
        <p className="eyebrow">
          {circle.invitedBy ? `${circle.invitedBy.firstName} invited you` : 'You’re invited'} · {timeAgo(circle.invitedAt)}
        </p>
        <h3 className="circle-card-name">{circle.name}</h3>
        {circle.description && <p className="circle-card-desc">{circle.description}</p>}
        <p className="circle-card-meta">
          <AvatarStack people={circle.members} size={24} />
          {plural(circle.memberCount, 'member')} · {plural(circle.itemCount, 'thing')} on the shelf ·{' '}
          <Link to={`/circles/${circle.id}`}>Take a look</Link>
        </p>
        <InlineError error={join.error ?? decline.error} />
        <div className="row gap wrap">
          <Button pending={join.pending} disabled={decline.pending} onClick={() => answer(true)}>
            Join the circle
          </Button>
          <Button variant="ghost" pending={decline.pending} disabled={join.pending} onClick={() => answer(false)}>
            No thanks
          </Button>
        </div>
      </div>
    </article>
  );
}
