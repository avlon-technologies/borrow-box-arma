import { useCallback, useEffect, useRef, useState } from 'react';

const TOKEN_KEY = 'borrowbox.token';

/**
 * Identity lives per browser tab (sessionStorage) so two tabs can be two
 * people. New tabs start as whoever was chosen most recently (localStorage).
 */
export const tokenStore = {
  get(): string | null {
    try {
      const t = sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      return t;
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) {
        sessionStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(TOKEN_KEY, token);
      } else {
        sessionStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch {
      /* storage unavailable — identity lasts until reload */
    }
  },
};

export class ApiError extends Error {
  status: number;
  code: string;
  details: any;
  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get fields(): Record<string, string> {
    return this.details?.fields ?? {};
  }
}

let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  raw?: Blob;
}

export async function api<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  let body: BodyInit | undefined;
  if (opts.raw) {
    headers['Content-Type'] = opts.raw.type || 'application/octet-stream';
    body = opts.raw;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  } catch {
    throw new ApiError(0, 'offline', 'We couldn’t reach BorrowBox. Check your connection and try again.');
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = data?.error;
    if (res.status === 401) onUnauthenticated?.();
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? 'Something went wrong. Please try again.', err?.details);
  }
  return data as T;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Load a resource, with loading/error state and optional refresh when the tab regains focus. */
export function useApi<T>(path: string | null, opts: { refreshOnFocus?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const current = useRef(path);
  current.current = path;

  const load = useCallback(
    async (quiet = false) => {
      if (!path) return;
      if (!quiet) setLoading(true);
      try {
        const result = await api<T>(path);
        if (current.current === path) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (current.current === path && !quiet) setError(e as ApiError);
      } finally {
        if (current.current === path) setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  useEffect(() => {
    if (!opts.refreshOnFocus) return;
    const onFocus = () => {
      if (document.visibilityState === 'visible') load(true);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load, opts.refreshOnFocus]);

  return { data, error, loading, reload: () => load(true), setData };
}

/**
 * Run a write. While it's in flight further calls are ignored, and every
 * attempt of the same intent carries the same Idempotency-Key, so a double
 * click or a retry after a flaky connection can never act twice.
 */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const key = useRef(newKey());
  const busy = useRef(false);

  const run = useCallback(async <T,>(fn: (idempotencyKey: string) => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await fn(key.current);
      key.current = newKey();
      return result;
    } catch (e) {
      const err = e as ApiError;
      // A rule said no: the next attempt is a new intent.
      if (err.status && err.status < 500) key.current = newKey();
      setError(err);
      return undefined;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);

  return { run, pending, error, clearError: () => setError(null) };
}
