import { Link } from 'react-router-dom';
import { Package, Plus } from 'lucide-react';
import { useApi } from '../api.ts';
import { useSession } from '../session.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/ui.tsx';
import { LoanSection } from '../components/LoanList.tsx';
import { ItemCard } from '../components/ItemCard.tsx';
import type { LoanCard, OwnItem } from '../types.ts';

export function Lending() {
  const { today } = useSession();
  const loans = useApi<{ lending: LoanCard[] }>('/loans', { refreshOnFocus: true });
  const items = useApi<OwnItem[]>('/my/items', { refreshOnFocus: true });
  if (loans.error) return <ErrorState error={loans.error} onRetry={loans.reload} />;
  if (items.error) return <ErrorState error={items.error} onRetry={items.reload} />;
  if (!loans.data || !items.data) return <Spinner />;

  const all = loans.data.lending;
  const needs = all.filter((l) => l.needsAttention);
  const rest = all.filter((l) => !l.needsAttention);
  const out = rest.filter((l) => l.status === 'borrowed' || l.status === 'returning');
  const upcoming = rest.filter((l) => l.status === 'approved' || l.status === 'ready').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const requested = rest.filter((l) => l.status === 'requested');
  const past = rest.filter((l) => ['returned', 'declined', 'cancelled'].includes(l.status));

  return (
    <div className="dash">
      <header className="page-head row between wrap">
        <div>
          <h1>Lending</h1>
          <p className="muted">Your shelf, and everything going in and out of it.</p>
        </div>
        <Link to="/items/new" className="btn btn-primary">
          <Plus size={18} aria-hidden />
          <span>Share something</span>
        </Link>
      </header>

      <LoanSection title="Needs you" hint="Requests to answer, returns to confirm and handoffs coming up." loans={needs} today={today} />
      <LoanSection title="Out right now" loans={out} today={today} />
      <LoanSection title="Coming up" loans={upcoming} today={today} />
      <LoanSection title="Older requests" loans={requested} today={today} />

      <section className="loan-section" aria-label="Your shelf">
        <h2 className="section-title">
          Your shelf <span className="count">{items.data.length}</span>
        </h2>
        {items.data.length === 0 ? (
          <EmptyState icon={<Package size={28} />} title="Your shelf is empty" action={<Link to="/items/new" className="btn btn-primary"><span>Share your first item</span></Link>}>
            Got a ladder, a tent or a pasta maker that mostly sits around? Your neighbours would love to borrow it.
          </EmptyState>
        ) : (
          <div className="grid">
            {items.data.map((i) => (
              <ItemCard
                key={i.id}
                item={i}
                today={today}
                extra={i.openRequests > 0 ? <p className="item-card-note">{i.openRequests === 1 ? '1 request waiting' : `${i.openRequests} requests waiting`}</p> : null}
              />
            ))}
          </div>
        )}
      </section>

      <LoanSection title="Past loans" loans={past} today={today} />
    </div>
  );
}
