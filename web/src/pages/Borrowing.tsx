import { Link } from 'react-router-dom';
import { HandHeart } from 'lucide-react';
import { useApi } from '../api.ts';
import { useSession } from '../session.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/ui.tsx';
import { LoanSection } from '../components/LoanList.tsx';
import type { LoanCard } from '../types.ts';

export function Borrowing() {
  const { today } = useSession();
  const { data, error, loading, reload } = useApi<{ borrowing: LoanCard[] }>('/loans', { refreshOnFocus: true });
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <Spinner />;
  const all = data.borrowing;
  const needs = all.filter((l) => l.needsAttention);
  const rest = all.filter((l) => !l.needsAttention);
  const withYou = rest.filter((l) => l.status === 'borrowed' || l.status === 'returning');
  const upcoming = rest.filter((l) => l.status === 'approved' || l.status === 'ready').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const waiting = rest.filter((l) => l.status === 'requested');
  const past = rest.filter((l) => ['returned', 'declined', 'cancelled'].includes(l.status));

  return (
    <div className="dash">
      <header className="page-head">
        <h1>Borrowing</h1>
        <p className="muted">Things you’ve asked for, have now, or borrowed before.</p>
      </header>
      {all.length === 0 ? (
        <EmptyState icon={<HandHeart size={28} />} title="You haven’t borrowed anything yet" action={<Link to="/" className="btn btn-primary"><span>Explore what’s nearby</span></Link>}>
          Find something on a neighbour’s shelf and ask for the dates you need.
        </EmptyState>
      ) : (
        <>
          <LoanSection title="Needs you" loans={needs} today={today} />
          <LoanSection title="With you now" loans={withYou} today={today} />
          <LoanSection title="Coming up" loans={upcoming} today={today} />
          <LoanSection title="Waiting to hear back" loans={waiting} today={today} />
          <LoanSection title="Past" loans={past} today={today} />
        </>
      )}
    </div>
  );
}
