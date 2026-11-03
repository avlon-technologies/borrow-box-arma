import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, Baby, Camera, CookingPot, Drill, Gamepad2, Leaf, Loader2, PartyPopper, Plug, Tent, type LucideIcon,
} from 'lucide-react';
import type { Person } from '../types.ts';

export function Avatar({ person, size = 36 }: { person: Pick<Person, 'name' | 'avatarHue'>; size?: number }) {
  const initials = person.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
  return (
    <span
      className="avatar"
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `hsl(${person.avatarHue} 55% 88%)`,
        color: `hsl(${person.avatarHue} 45% 28%)`,
      }}
    >
      {initials}
    </span>
  );
}

const CATEGORY_ART: Record<string, { icon: LucideIcon; hue: number }> = {
  Tools: { icon: Drill, hue: 28 },
  Outdoors: { icon: Tent, hue: 140 },
  Kitchen: { icon: CookingPot, hue: 12 },
  Electronics: { icon: Plug, hue: 220 },
  'Home & Garden': { icon: Leaf, hue: 95 },
  Kids: { icon: Baby, hue: 330 },
  Hobbies: { icon: Gamepad2, hue: 265 },
  Party: { icon: PartyPopper, hue: 45 },
};

export function ItemImage({ url, title, category, className = '' }: { url: string | null; title: string; category: string; className?: string }) {
  if (url) return <img className={`item-img ${className}`} src={url} alt={title} loading="lazy" decoding="async" />;
  const art = CATEGORY_ART[category] ?? { icon: Camera, hue: 30 };
  const Icon = art.icon;
  return (
    <div
      className={`item-img item-img-placeholder ${className}`}
      role="img"
      aria-label={`${title} (no photo yet)`}
      style={{
        background: `radial-gradient(circle at 30% 25%, hsl(${art.hue} 70% 92%), hsl(${art.hue} 45% 80%))`,
        color: `hsl(${art.hue} 40% 32%)`,
      }}
    >
      <Icon size={56} strokeWidth={1.4} aria-hidden />
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  pending?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', pending, icon, block, children, className = '', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`btn btn-${variant} ${block ? 'btn-block' : ''} ${className}`}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...rest}
    >
      {pending ? <Loader2 className="spin" size={18} aria-hidden /> : icon}
      <span>{children}</span>
    </button>
  );
});

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <Loader2 className="spin" size={28} aria-hidden />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon" aria-hidden>{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: { message: string }; onRetry?: () => void }) {
  return (
    <div className="empty error-state" role="alert">
      <div className="empty-icon" aria-hidden>
        <AlertCircle size={28} />
      </div>
      <h3>That didn’t load</h3>
      <p>{error.message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function InlineError({ error }: { error: { message: string } | null | undefined }) {
  if (!error) return null;
  return (
    <p className="inline-error" role="alert">
      <AlertCircle size={16} aria-hidden /> {error.message}
    </p>
  );
}

export function PersonLink({ person, sub }: { person: Person; sub?: ReactNode }) {
  return (
    <span className="person">
      <Avatar person={person} size={32} />
      <span>
        <span className="person-name">{person.name}</span>
        <span className="person-sub">{sub ?? person.neighbourhood}</span>
      </span>
    </span>
  );
}

export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent'; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="back-link" to={to}>
      ← {children}
    </Link>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card skeleton-card">
          <div className="skeleton skeleton-img" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </div>
      ))}
    </div>
  );
}
