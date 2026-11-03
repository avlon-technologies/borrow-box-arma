import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthenticatedHandler, tokenStore } from './api.ts';
import { setTimeZone } from './format.ts';
import type { CircleTag, Config, Person } from './types.ts';

type Attention = { borrowing: number; lending: number; circles: number };

interface SessionState {
  user: Person | null;
  config: Config | null;
  attention: Attention;
  /** Circles you're an active member of. */
  circles: CircleTag[];
  today: string;
  ready: boolean;
  signIn: (userId: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Person | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [attention, setAttention] = useState<Attention>({ borrowing: 0, lending: 0, circles: 0 });
  const [circles, setCircles] = useState<CircleTag[]>([]);
  const [today, setToday] = useState('');
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      return;
    }
    try {
      const me = await api<{ user: Person; attention: Attention; circles: CircleTag[]; today: string }>('/me');
      setUser(me.user);
      setAttention(me.attention);
      setCircles(me.circles);
      setToday(me.today);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      tokenStore.set(null);
      setUser(null);
    });
    (async () => {
      try {
        const cfg = await api<Config>('/config');
        setConfig(cfg);
        setToday(cfg.today);
        setTimeZone(cfg.timeZone);
      } catch {
        /* shown as an error by the shell */
      }
      await refresh();
      setReady(true);
    })();
  }, [refresh]);

  // Keep "needs you" counts fresh when coming back to the tab.
  useEffect(() => {
    const onFocus = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [refresh]);

  const signIn = useCallback(async (userId: string) => {
    const res = await api<{ token: string; user: Person }>('/session', { body: { userId } });
    tokenStore.set(res.token);
    setUser(res.user);
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api('/session', { method: 'DELETE' });
    } catch {
      /* ignore */
    }
    tokenStore.set(null);
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, config, attention, circles, today, ready, signIn, signOut, refresh }}>{children}</Ctx.Provider>
  );
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession outside provider');
  return ctx;
}
