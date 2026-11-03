import { useEffect, useState } from 'react';
import { api, type ApiError } from '../api.ts';
import { useSession } from '../session.tsx';
import { Avatar, ErrorState, InlineError, Spinner } from '../components/ui.tsx';
import { Logo } from '../App.tsx';
import type { Person } from '../types.ts';

export function Welcome() {
  const { signIn } = useSession();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<ApiError | null>(null);

  const load = () => api<Person[]>('/people').then(setPeople).catch(setError);
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <Logo />
        <h1 className="welcome-title">
          Borrow from neighbours.
          <br />
          <em>Lend with confidence.</em>
        </h1>
        <p className="welcome-lede">
          BorrowBox is a little lending library for your street — tents, drills, stand mixers and everything in
          between, shared between people who know each other.
        </p>
        <section aria-labelledby="who" className="welcome-card">
          <h2 id="who">Who’s borrowing today?</h2>
          <p className="muted">This is a demo community. Pick anyone — you can switch from the menu at any time, and each browser tab can be a different person.</p>
          {error && <ErrorState error={error} onRetry={load} />}
          {!people && !error && <Spinner />}
          <ul className="people-list">
            {people?.map((p) => (
              <li key={p.id}>
                <button
                  className="person-choice"
                  disabled={!!busy}
                  aria-busy={busy === p.id || undefined}
                  onClick={async () => {
                    setBusy(p.id);
                    setSignInError(null);
                    try {
                      await signIn(p.id);
                    } catch (e) {
                      setSignInError(e as ApiError);
                      setBusy(null);
                    }
                  }}
                >
                  <Avatar person={p} size={48} />
                  <span className="person-choice-text">
                    <strong>{p.name}</strong>
                    <span>{p.neighbourhood}</span>
                    <small>{p.bio}</small>
                  </span>
                  <span className="person-choice-go" aria-hidden>
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <InlineError error={signInError} />
        </section>
      </div>
    </div>
  );
}
