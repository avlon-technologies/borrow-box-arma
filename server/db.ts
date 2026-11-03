import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');

export type DB = DatabaseSync;

export function defaultDataDir(): string {
  return process.env.BORROWBOX_DATA_DIR ?? join(ROOT, 'data');
}

export function openDatabase(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL lets readers proceed while one writer holds the lock; busy_timeout
  // makes concurrent writers queue instead of failing immediately.
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  // schema.sql is the V1 baseline (idempotent); later changes are numbered
  // migrations, so a database from an older version upgrades in place.
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  migrate(db);
  return db;
}

/** Schema changes after V1, applied in order. user_version = last applied. */
const MIGRATIONS = ['002-circles.sql'];

function migrate(db: DB) {
  const version = () => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version() >= MIGRATIONS.length) return;
  // Take the write lock, then re-check: another process may have migrated first.
  transaction(db, () => {
    for (let v = version(); v < MIGRATIONS.length; v++) {
      db.exec(readFileSync(join(here, 'migrations', MIGRATIONS[v]), 'utf8'));
      db.exec(`PRAGMA user_version = ${v + 1}`);
    }
  });
}

export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Run `fn` inside a write transaction. BEGIN IMMEDIATE takes the write lock up
 * front, so the "check for conflicts, then write" sequence inside is atomic
 * even across processes sharing the database file.
 */
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export type Row = Record<string, any>;

export function one<T = Row>(db: DB, sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T = Row>(db: DB, sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(db: DB, sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}
