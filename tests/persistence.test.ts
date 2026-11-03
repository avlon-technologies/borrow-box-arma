import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.ts';
import { seed } from '../server/seed.ts';
import { requestLoan } from '../server/domain/loans.ts';
import { addDays, today } from '../server/dates.ts';

describe('persistence and seeding', () => {
  it('keeps data across a restart (closing and reopening the database file)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'borrowbox-persist-'));
    const file = join(dir, 'borrowbox.db');
    let db = openDatabase(file);
    seed(db, dir);
    const loan = requestLoan(db, 'sam', { itemId: 'item-telescope', startDate: addDays(today(), 2), endDate: addDays(today(), 3), note: 'persist me' });
    db.close();
    db = openDatabase(file);
    const row = db.prepare(`SELECT status, note FROM loans WHERE id = ?`).get(loan.id) as any;
    expect(row).toMatchObject({ status: 'requested', note: 'persist me' });
    // Seeding again doesn't duplicate anything.
    expect(seed(db, dir)).toBe(false);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('seeds a varied, repeatable demo community', () => {
    const counts = [0, 1].map(() => {
      const dir = mkdtempSync(join(tmpdir(), 'borrowbox-seed-'));
      const db = openDatabase(join(dir, 'borrowbox.db'));
      seed(db, dir);
      const c = {
        users: (db.prepare(`SELECT count(*) n FROM users`).get() as any).n,
        items: (db.prepare(`SELECT count(*) n FROM items`).get() as any).n,
        categories: (db.prepare(`SELECT count(DISTINCT category) n FROM items`).get() as any).n,
        statuses: (db.prepare(`SELECT group_concat(status) s FROM (SELECT DISTINCT status FROM loans ORDER BY status)`).get() as any).s,
      };
      db.close();
      rmSync(dir, { recursive: true, force: true });
      return c;
    });
    expect(counts[0]).toEqual(counts[1]);
    expect(counts[0].users).toBeGreaterThanOrEqual(3);
    expect(counts[0].items).toBeGreaterThanOrEqual(8);
    expect(counts[0].categories).toBeGreaterThanOrEqual(6);
    expect(counts[0].statuses).toBe('approved,borrowed,ready,requested,returned,returning');
  });
});
