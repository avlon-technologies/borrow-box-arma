import express, { type Request, type Response, type NextFunction } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DB, one, run } from './db.ts';
import { TIME_ZONE, nowIso, today } from './dates.ts';
import { AppError, invalid, unauthenticated } from './domain/errors.ts';
import { listPeople, publicUser } from './domain/users.ts';
import * as items from './domain/items.ts';
import * as loans from './domain/loans.ts';
import { CATEGORIES, CONDITIONS, CONDITION_LABELS, LIMITS } from '../shared/constants.ts';

export interface AppOptions {
  db: DB;
  dataDir: string;
  /** Built web app to serve (production). */
  webDir?: string;
}

const COOKIE = 'bb_session';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sniffImage(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return { ext: 'gif', mime: 'image/gif' };
  return null;
}

export function createApp({ db, dataDir, webDir }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  const uploadDir = join(dataDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });

  app.use('/api', express.json({ limit: '200kb' }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Who is this? A session cookie maps to one of the community's people.
  app.use('/api', (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const s = one<any>(db, `SELECT user_id FROM sessions WHERE token = ?`, token);
      if (s) req.userId = s.user_id;
    }
    next();
  });

  // Basic CSRF defence: state-changing requests must be JSON or an image upload,
  // which browsers can't send cross-site without a CORS preflight we never grant.
  app.use('/api', (req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const type = req.headers['content-type'] ?? '';
    if (req.headers['content-length'] === '0' || type.startsWith('application/json') || type.startsWith('image/')) return next();
    next(new AppError(415, 'unsupported', 'Unsupported request.'));
  });

  const auth = (req: Request): string => {
    if (!req.userId) throw unauthenticated();
    return req.userId;
  };

  /**
   * Wrap a state-changing handler so a retried or double-clicked submission
   * (same Idempotency-Key) replays the first response instead of acting twice.
   */
  const mutation =
    (fn: (req: Request, userId: string) => unknown, status = 200) =>
    (req: Request, res: Response) => {
      const userId = auth(req);
      const key = req.header('Idempotency-Key');
      const route = `${req.method} ${req.originalUrl}`;
      if (key) {
        if (key.length > 100) throw invalid('Bad idempotency key.');
        const prior = one<any>(db, `SELECT * FROM idempotency_keys WHERE user_id = ? AND key = ?`, userId, key);
        if (prior) {
          if (prior.route !== route) throw invalid('That idempotency key was already used for something else.');
          res.setHeader('Idempotent-Replay', 'true');
          res.status(prior.status_code).type('json').send(prior.body);
          return;
        }
      }
      const result = fn(req, userId);
      const body = JSON.stringify(result ?? { ok: true });
      if (key) {
        run(
          db,
          `INSERT OR IGNORE INTO idempotency_keys (user_id, key, route, status_code, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          userId, key, route, status, body, nowIso(),
        );
      }
      res.status(status).type('json').send(body);
    };

  const r = express.Router();

  // ---- session & config
  r.get('/config', (_req, res) => {
    res.json({
      timeZone: TIME_ZONE,
      today: today(),
      categories: CATEGORIES,
      conditions: CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABELS[c] })),
      limits: LIMITS,
    });
  });
  r.get('/people', (_req, res) => {
    res.json(listPeople(db));
  });
  r.post('/session', (req, res) => {
    const userId = req.body?.userId;
    if (typeof userId !== 'string' || !one(db, `SELECT 1 FROM users WHERE id = ?`, userId))
      throw invalid('Choose someone from the list.');
    const token = randomBytes(24).toString('base64url');
    run(db, `INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`, token, userId, nowIso());
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    res.json({ user: publicUser(db, userId) });
  });
  r.delete('/session', (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) run(db, `DELETE FROM sessions WHERE token = ?`, token);
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });
  r.get('/me', (req, res) => {
    const userId = auth(req);
    res.json({ user: publicUser(db, userId), attention: loans.attentionCounts(db, userId), today: today() });
  });

  // ---- uploads (raw image bytes; the browser resizes before sending)
  r.post(
    '/uploads',
    express.raw({ type: 'image/*', limit: LIMITS.uploadBytes }),
    mutation((req, userId) => {
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length === 0) throw invalid('Choose a photo to upload.');
      const kind = sniffImage(buf);
      if (!kind) throw invalid('That file doesn’t look like a photo. Try a JPEG, PNG, WebP or GIF.');
      const id = randomUUID();
      const fileName = `${id}.${kind.ext}`;
      writeFileSync(join(uploadDir, fileName), buf);
      run(
        db,
        `INSERT INTO uploads (id, uploader_id, file_name, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        id, userId, fileName, kind.mime, buf.length, nowIso(),
      );
      return { id, url: `/uploads/${fileName}` };
    }, 201),
  );

  // ---- items
  r.get('/items', (req, res) => {
    const userId = auth(req);
    res.json(
      items.listCatalog(db, userId, {
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        category: typeof req.query.category === 'string' ? req.query.category : undefined,
        availableNow: req.query.available === 'now',
        owner: typeof req.query.owner === 'string' ? req.query.owner : undefined,
      }),
    );
  });
  r.get('/my/items', (req, res) => {
    res.json(items.listOwnItems(db, auth(req)));
  });
  r.get('/items/:id', (req, res) => {
    res.json(items.getItemDetail(db, auth(req), req.params.id));
  });
  r.post('/items', mutation((req, u) => items.createItem(db, u, req.body), 201));
  r.put('/items/:id', mutation((req, u) => items.updateItem(db, u, req.params.id, req.body)));
  r.post('/items/:id/visibility', mutation((req, u) => items.setHidden(db, u, req.params.id, req.body?.hidden)));

  // ---- loans
  r.get('/loans', (req, res) => {
    res.json(loans.listLoansFor(db, auth(req)));
  });
  r.get('/loans/:id', (req, res) => {
    res.json(loans.getLoan(db, auth(req), req.params.id));
  });
  r.post('/loans', mutation((req, u) => loans.requestLoan(db, u, req.body), 201));
  const loanAction = (name: string, fn: (db: DB, u: string, id: string, body: unknown) => unknown) =>
    r.post(`/loans/:id/${name}`, mutation((req, u) => fn(db, u, req.params.id as string, req.body)));
  loanAction('approve', loans.approve);
  loanAction('decline', loans.decline);
  loanAction('cancel', loans.cancel);
  loanAction('ready', loans.markReady);
  loanAction('pickup', loans.confirmPickup);
  loanAction('return', loans.startReturn);
  loanAction('confirm-return', loans.confirmReturn);
  loanAction('followup', loans.addFollowUp);
  loanAction('messages', loans.addMessage);
  loanAction('extensions', loans.proposeExtension);
  r.post('/extensions/:id/accept', mutation((req, u) => loans.acceptExtension(db, u, req.params.id as string, req.body)));
  r.post('/extensions/:id/decline', mutation((req, u) => loans.declineExtension(db, u, req.params.id as string, req.body)));
  r.post('/extensions/:id/withdraw', mutation((req, u) => loans.withdrawExtension(db, u, req.params.id as string)));

  r.use((_req, _res, next) => next(new AppError(404, 'not_found', 'No such endpoint.')));
  app.use('/api', r);

  app.use(
    '/uploads',
    express.static(uploadDir, { maxAge: '30d', immutable: true, fallthrough: false }),
  );

  if (webDir && existsSync(webDir)) {
    app.use(express.static(webDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(webDir, 'index.html'));
    });
  }

  // Errors → calm, human JSON.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'too_large', message: 'That file is too big. Try a smaller photo.' } });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'invalid', message: 'The request was malformed.' } });
      return;
    }
    if (err?.status === 404 || err?.statusCode === 404) {
      res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } });
  });

  return app;
}
