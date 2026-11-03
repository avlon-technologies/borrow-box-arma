import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Compass, HandHeart, LogOut, Package, Users } from 'lucide-react';
import { useSession } from './session.tsx';
import { Avatar, Spinner } from './components/ui.tsx';
import { Welcome } from './pages/Welcome.tsx';
import { Explore } from './pages/Explore.tsx';
import { ItemPage } from './pages/ItemPage.tsx';
import { ItemForm } from './pages/ItemForm.tsx';
import { Borrowing } from './pages/Borrowing.tsx';
import { Lending } from './pages/Lending.tsx';
import { LoanPage } from './pages/LoanPage.tsx';
import { NotFound } from './pages/NotFound.tsx';
import { About } from './pages/About.tsx';
import { api } from './api.ts';
import type { Person } from './types.ts';

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="BorrowBox home">
      <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden>
        <rect width="64" height="64" rx="16" fill="var(--brand)" />
        <path d="M14 26 32 17l18 9v18L32 53 14 44Z" fill="var(--bg)" />
        <path d="M14 26l18 9 18-9M32 35v18" stroke="var(--brand)" strokeWidth="3.5" fill="none" strokeLinejoin="round" />
        <path d="M26 22.5l18 9" stroke="var(--sun)" strokeWidth="3.5" strokeLinecap="round" />
      </svg>
      <span>BorrowBox</span>
    </Link>
  );
}

function useTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    // Move focus to the main region so screen-reader users land on the new page.
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);
}

function PersonMenu() {
  const { user, signIn, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    api<Person[]>('/people').then(setPeople).catch(() => {});
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!user) return null;
  return (
    <div className="menu" ref={ref}>
      <button className="menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar person={user} size={34} />
        <span className="menu-name">{user.firstName}</span>
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          <p className="menu-heading">
            You’re using BorrowBox as <strong>{user.name}</strong>
          </p>
          <p className="menu-sub">
            <ArrowLeftRight size={14} aria-hidden /> Switch person (this tab only)
          </p>
          {people
            .filter((p) => p.id !== user.id)
            .map((p) => (
              <button
                key={p.id}
                role="menuitem"
                className="menu-item"
                onClick={async () => {
                  setOpen(false);
                  await signIn(p.id);
                  navigate('/');
                }}
              >
                <Avatar person={p} size={28} />
                <span>
                  {p.name}
                  <small>{p.neighbourhood}</small>
                </span>
              </button>
            ))}
          <hr />
          <button
            role="menuitem"
            className="menu-item"
            onClick={async () => {
              setOpen(false);
              await signOut();
              navigate('/');
            }}
          >
            <LogOut size={18} aria-hidden />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}

function Badge({ n, label }: { n: number; label: string }) {
  if (!n) return null;
  return (
    <span className="badge" aria-label={`${n} ${label}`}>
      {n}
    </span>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { attention } = useSession();
  useTitle();
  const nav = [
    { to: '/', label: 'Explore', icon: Compass, end: true, n: 0 },
    { to: '/borrowing', label: 'Borrowing', icon: HandHeart, n: attention.borrowing },
    { to: '/lending', label: 'Lending', icon: Package, n: attention.lending },
  ];
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="app-header">
        <div className="container header-inner">
          <Logo />
          <nav className="top-nav" aria-label="Main">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className="top-nav-link">
                {n.label}
                <Badge n={n.n} label="things need you" />
              </NavLink>
            ))}
          </nav>
          <PersonMenu />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="container main">
        {children}
        <footer className="footer">
          <span>BorrowBox · a lending library for friends and neighbours</span>
          <Link to="/about">About & photo credits</Link>
        </footer>
      </main>
      <nav className="bottom-nav" aria-label="Main">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="bottom-nav-link">
            <span className="bottom-nav-icon">
              <n.icon size={22} aria-hidden />
              <Badge n={n.n} label="things need you" />
            </span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export function App() {
  const { user, ready, config } = useSession();
  if (!ready)
    return (
      <div className="boot">
        <Spinner label="Opening BorrowBox" />
      </div>
    );
  if (!config)
    return (
      <div className="boot">
        <div className="empty">
          <div className="empty-icon"><Users size={28} aria-hidden /></div>
          <h3>BorrowBox isn’t reachable</h3>
          <p>The server didn’t answer. Make sure it’s running (<code>npm start</code>) and reload.</p>
        </div>
      </div>
    );
  if (!user) return <Welcome />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Explore />} />
        <Route path="/items/new" element={<ItemForm />} />
        <Route path="/items/:id" element={<ItemPage />} />
        <Route path="/items/:id/edit" element={<ItemForm />} />
        <Route path="/borrowing" element={<Borrowing />} />
        <Route path="/lending" element={<Lending />} />
        <Route path="/loans/:id" element={<LoanPage />} />
        <Route path="/about" element={<About />} />
        <Route path="/welcome" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Shell>
  );
}
