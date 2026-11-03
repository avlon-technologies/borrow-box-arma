import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, SearchX, X } from 'lucide-react';
import { useApi } from '../api.ts';
import { useSession } from '../session.tsx';
import { greeting } from '../format.ts';
import { ItemCard } from '../components/ItemCard.tsx';
import { EmptyState, ErrorState, SkeletonGrid, Button } from '../components/ui.tsx';
import type { ItemSummary } from '../types.ts';

export function Explore() {
  const { user, config, today, attention, circles } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const availableNow = params.get('available') === 'now';
  const circle = params.get('circle') ?? '';
  const [text, setText] = useState(q);

  // Debounce typing into the URL so search survives refresh and back/forward.
  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== q) update({ q: text || null });
    }, 250);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  }

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (category) query.set('category', category);
  if (availableNow) query.set('available', 'now');
  if (circle) query.set('circle', circle);
  const { data, error, loading, reload } = useApi<ItemSummary[]>(`/items?${query}`);
  const filtered = !!(q || category || availableNow || circle);
  const needs = attention.borrowing + attention.lending;

  return (
    <div className="explore">
      <section className="hero">
        <div>
          <p className="eyebrow">{greeting()}, {user?.firstName}</p>
          <h1>What do you need to borrow?</h1>
          {needs > 0 && (
            <p className="hero-note">
              <Link to={attention.lending ? '/lending' : '/borrowing'}>
                {needs === 1 ? 'One thing needs' : `${needs} things need`} your attention →
              </Link>
            </p>
          )}
        </div>
        <Link to="/items/new" className="btn btn-secondary hero-share">
          <Plus size={18} aria-hidden />
          <span>Share something</span>
        </Link>
      </section>

      <div className="filters" role="search">
        <label className="search">
          <Search size={18} aria-hidden />
          <span className="sr-only">Search items</span>
          <input
            type="search"
            placeholder="Try “tent”, “drill” or a neighbour’s name"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {text && (
            <button className="icon-btn" onClick={() => setText('')} aria-label="Clear search">
              <X size={16} />
            </button>
          )}
        </label>
        {circles.length > 0 && (
          <div className="chips" role="group" aria-label="Shared by">
            <button className={`chip ${!circle ? 'chip-on' : ''}`} aria-pressed={!circle} onClick={() => update({ circle: null })}>
              All shelves
            </button>
            {circles.map((c) => (
              <button
                key={c.id}
                className={`chip chip-circle ${circle === c.id ? 'chip-on' : ''}`}
                aria-pressed={circle === c.id}
                onClick={() => update({ circle: circle === c.id ? null : c.id })}
              >
                <i style={{ background: `hsl(${c.hue} 55% 55%)` }} aria-hidden />
                {c.name}
              </button>
            ))}
          </div>
        )}
        <div className="chips" role="group" aria-label="Category">
          <button className={`chip ${!category ? 'chip-on' : ''}`} aria-pressed={!category} onClick={() => update({ category: null })}>
            Everything
          </button>
          {config?.categories.map((c) => (
            <button key={c} className={`chip ${category === c ? 'chip-on' : ''}`} aria-pressed={category === c} onClick={() => update({ category: category === c ? null : c })}>
              {c}
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={availableNow} onChange={(e) => update({ available: e.target.checked ? 'now' : null })} />
          <span className="toggle-track" aria-hidden><span /></span>
          Available today
        </label>
      </div>

      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data && <SkeletonGrid />}
      {data && data.length === 0 && (
        filtered ? (
          <EmptyState
            icon={<SearchX size={28} />}
            title="Nothing matches yet"
            action={<Button variant="secondary" onClick={() => { setText(''); setParams({}, { replace: true }); }}>Clear filters</Button>}
          >
            Try a different word or category — or ask around and someone might share one.
          </EmptyState>
        ) : (
          <EmptyState icon={<Plus size={28} />} title="The shelves are empty" action={<Link className="btn btn-primary" to="/items/new"><span>Share the first thing</span></Link>}>
            Be the first to share something with your neighbours.
          </EmptyState>
        )
      )}
      {data && data.length > 0 && (
        <>
          <p className="result-count" aria-live="polite">
            {filtered ? `${data.length} ${data.length === 1 ? 'thing' : 'things'} found` : `${data.length} things to borrow nearby`}
          </p>
          <div className="grid">
            {data.map((item) => (
              <ItemCard key={item.id} item={item} today={today} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
