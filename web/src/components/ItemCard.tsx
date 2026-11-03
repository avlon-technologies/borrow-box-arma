import { Link } from 'react-router-dom';
import { EyeOff, Lock } from 'lucide-react';
import { Avatar, ItemImage } from './ui.tsx';
import { formatDay, diffDays } from '../format.ts';
import type { ItemSummary } from '../types.ts';

export function availabilityText(item: ItemSummary, today: string): { text: string; tone: 'good' | 'warn' | 'neutral' } {
  const a = item.availability;
  if (item.hidden) return { text: 'Paused', tone: 'neutral' };
  if (a.state === 'out') {
    if (a.returning) return { text: 'On its way back', tone: 'neutral' };
    if (a.overdue) return { text: 'Out · running late', tone: 'warn' };
    return { text: `Out until ${formatDay(a.backOn!)}`, tone: 'neutral' };
  }
  if (a.nextBookedFrom && diffDays(today, a.nextBookedFrom) <= 7) {
    const n = diffDays(today, a.nextBookedFrom);
    return { text: n === 1 ? 'Free today · booked tomorrow' : `Free for ${n} days`, tone: 'good' };
  }
  return { text: 'Available', tone: 'good' };
}

export function ItemCard({ item, today, extra }: { item: ItemSummary; today: string; extra?: React.ReactNode }) {
  const avail = availabilityText(item, today);
  return (
    <article className="card item-card">
      <Link to={`/items/${item.id}`} className="item-card-link">
        <div className="item-card-media">
          <ItemImage url={item.imageUrl} title={item.title} category={item.category} />
          <span className={`avail avail-${avail.tone}`}>
            <i aria-hidden /> {avail.text}
          </span>
          {item.hidden && (
            <span className="hidden-flag">
              <EyeOff size={14} aria-hidden /> Hidden
            </span>
          )}
        </div>
        <div className="item-card-body">
          <p className="item-card-cat">{item.category}</p>
          <h3 className="item-card-title">{item.title}</h3>
          <p className="item-card-owner">
            <Avatar person={item.owner} size={22} />
            <span>{item.isMine ? 'Yours' : `${item.owner.firstName} · ${item.owner.neighbourhood}`}</span>
          </p>
          {item.audience === 'circles' && !extra && (
            <p className="item-card-circle">
              <Lock size={13} aria-hidden />
              <span>{item.circles.length ? item.circles.map((c) => c.name).join(' · ') : 'Circles only'}</span>
            </p>
          )}
          {extra}
        </div>
      </Link>
    </article>
  );
}
