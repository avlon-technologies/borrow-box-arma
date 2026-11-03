import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../../server/app.ts';
import { openDatabase, type DB } from '../../server/db.ts';
import { seed } from '../../server/seed.ts';
import { setClock } from '../../server/dates.ts';

export const FIXED_NOW = '2026-06-15T16:00:00Z'; // 12:00 in Toronto → "today" is 2026-06-15
export const TODAY = '2026-06-15';

export function pinClock(iso = FIXED_NOW) {
  setClock(() => new Date(iso));
}

export interface Harness {
  db: DB;
  dir: string;
  dbFile: string;
  app: ReturnType<typeof createApp>;
  as: (userId: string) => Promise<ReturnType<typeof request.agent>>;
  close: () => void;
}

export async function makeHarness(opts: { seed?: boolean } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'borrowbox-test-'));
  const dbFile = join(dir, 'borrowbox.db');
  const db = openDatabase(dbFile);
  if (opts.seed !== false) seed(db, dir);
  const app = createApp({ db, dataDir: dir });
  const as = async (userId: string) => {
    const agent = request.agent(app);
    const res = await agent.post('/api/session').send({ userId });
    if (res.status !== 200) throw new Error(`login failed for ${userId}: ${res.status}`);
    return agent;
  };
  return {
    db, dir, dbFile, app, as,
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Insert a bare user + item for tests that don't want the seeded story. */
export function addPerson(db: DB, id: string) {
  db.prepare(`INSERT INTO users (id, name, first_name, neighbourhood, created_at) VALUES (?, ?, ?, 'Test', '2026-01-01T00:00:00Z')`)
    .run(id, id[0].toUpperCase() + id.slice(1) + ' Test', id[0].toUpperCase() + id.slice(1));
}

export function addItem(db: DB, id: string, ownerId: string, maxDays = 14) {
  db.prepare(`INSERT INTO items (id, owner_id, title, category, max_days, created_at, updated_at) VALUES (?, ?, ?, 'Tools', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
    .run(id, ownerId, `Thing ${id}`, maxDays);
}
