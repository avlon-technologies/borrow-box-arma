import { Link } from 'react-router-dom';
import { Avatar, ItemImage, Pill } from './ui.tsx';
import { statusLabel, summaryLine } from '../loanCopy.ts';
import type { LoanCard } from '../types.ts';

function rowLine(loan: LoanCard, today: string) {
  const line = summaryLine(loan, today);
  const other = loan.role === 'owner' ? loan.borrower.firstName : loan.owner.firstName;
  if (line.includes(other)) return line;
  return loan.role === 'owner' ? `${other} · ${line}` : `From ${other} · ${line}`;
}

export function LoanRow({ loan, today }: { loan: LoanCard; today: string }) {
  const label = statusLabel(loan);
  const other = loan.role === 'owner' ? loan.borrower : loan.owner;
  return (
    <li>
      <Link to={`/loans/${loan.id}`} className={`loan-row ${loan.needsAttention ? 'needs' : ''}`}>
        <span className="loan-row-img">
          <ItemImage url={loan.item.imageUrl} title={loan.item.title} category={loan.item.category} />
        </span>
        <span className="loan-row-text">
          <strong>{loan.item.title}</strong>
          <span className="loan-row-sub">
            <Avatar person={other} size={20} />
            {rowLine(loan, today)}
          </span>
          {loan.pendingExtension && (
            <span className="loan-row-ext">
              {loan.role === 'owner' ? `${other.firstName} asked for more time` : 'You asked for more time'}
            </span>
          )}
        </span>
        <Pill tone={label.tone}>{label.text}</Pill>
      </Link>
    </li>
  );
}

export function LoanSection({ title, hint, loans, today, emptyText }: { title: string; hint?: string; loans: LoanCard[]; today: string; emptyText?: string }) {
  if (!loans.length && !emptyText) return null;
  return (
    <section className="loan-section" aria-label={title}>
      <h2 className="section-title">
        {title} {loans.length > 0 && <span className="count">{loans.length}</span>}
      </h2>
      {hint && <p className="muted small">{hint}</p>}
      {loans.length ? (
        <ul className="loan-list">
          {loans.map((l) => (
            <LoanRow key={l.id} loan={l} today={today} />
          ))}
        </ul>
      ) : (
        <p className="muted">{emptyText}</p>
      )}
    </section>
  );
}
