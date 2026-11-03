import { type DB, one, all } from '../db.ts';
import { notFound } from './errors.ts';

export interface PublicUser {
  id: string;
  name: string;
  firstName: string;
  neighbourhood: string;
  bio: string;
  avatarHue: number;
  memberSince: string;
}

function toPublic(row: any): PublicUser {
  return {
    id: row.id,
    name: row.name,
    firstName: row.first_name,
    neighbourhood: row.neighbourhood,
    bio: row.bio,
    avatarHue: row.avatar_hue,
    memberSince: row.created_at,
  };
}

const cache = new WeakMap<DB, Map<string, PublicUser>>();

export function publicUser(db: DB, id: string): PublicUser {
  let users = cache.get(db);
  if (!users) cache.set(db, (users = new Map()));
  const hit = users.get(id);
  if (hit) return hit;
  const row = one(db, `SELECT * FROM users WHERE id = ?`, id);
  if (!row) throw notFound('That person');
  const user = toPublic(row);
  users.set(id, user);
  return user;
}

export function listPeople(db: DB): PublicUser[] {
  return all(db, `SELECT * FROM users ORDER BY name`).map(toPublic);
}
