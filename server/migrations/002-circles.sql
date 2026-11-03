-- Migration 002: lending circles.
--
-- A circle is a small group of friends who share a shelf. People join by
-- accepting an invitation, and items can be contributed to one or more
-- circles. An item's audience says who can ask to borrow it:
--   'everyone' — anyone in the BorrowBox community (the V1 behaviour)
--   'circles'  — only active members of a circle the item is shared with
--
-- Core rule: access is checked when someone ASKS. Once a loan exists it is
-- governed by the owner and borrower alone, so membership changes never
-- invalidate requests, reservations or loans already made. Each loan records
-- the circle that let the borrower ask (via_circle_id), and that never changes.

CREATE TABLE circles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  hue         INTEGER NOT NULL DEFAULT 20 CHECK (hue BETWEEN 0 AND 359),
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- One row per (circle, person) holding their CURRENT relationship to the
-- circle. Every change is also written to circle_events, so history is kept.
CREATE TABLE circle_members (
  circle_id  TEXT NOT NULL REFERENCES circles(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  status     TEXT NOT NULL CHECK (status IN ('invited','active','declined','withdrawn','left','removed')),
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('organizer','member')),
  invited_by TEXT REFERENCES users(id),
  since      TEXT NOT NULL, -- when the current status began
  PRIMARY KEY (circle_id, user_id)
);
CREATE INDEX circle_members_user_idx ON circle_members(user_id, status);

-- Guard: only legal membership changes. Anyone who has left (or was removed,
-- declined, or had an invitation withdrawn) can be invited again.
CREATE TRIGGER circle_members_legal_transition
BEFORE UPDATE OF status ON circle_members
WHEN OLD.status <> NEW.status AND NOT (
     (OLD.status = 'invited' AND NEW.status IN ('active','declined','withdrawn'))
  OR (OLD.status = 'active'  AND NEW.status IN ('left','removed'))
  OR (OLD.status IN ('declined','withdrawn','left','removed') AND NEW.status = 'invited')
)
BEGIN
  SELECT RAISE(ABORT, 'ILLEGAL_TRANSITION');
END;

-- Which circles an item is shared with.
CREATE TABLE item_circles (
  item_id   TEXT NOT NULL REFERENCES items(id),
  circle_id TEXT NOT NULL REFERENCES circles(id),
  added_at  TEXT NOT NULL,
  PRIMARY KEY (item_id, circle_id)
);
CREATE INDEX item_circles_circle_idx ON item_circles(circle_id);

-- Guard: only an active member can put their item on a circle's shelf.
CREATE TRIGGER item_circles_owner_is_member
BEFORE INSERT ON item_circles
BEGIN
  SELECT RAISE(ABORT, 'NOT_A_MEMBER') WHERE NOT EXISTS (
    SELECT 1 FROM items i JOIN circle_members m ON m.user_id = i.owner_id
     WHERE i.id = NEW.item_id AND m.circle_id = NEW.circle_id AND m.status = 'active');
END;

-- Guard: when someone's membership ends, their items leave that circle's
-- shelf. (The domain layer does this first and records it; this is the backstop.)
CREATE TRIGGER circle_members_end_withdraws_items
AFTER UPDATE OF status ON circle_members
WHEN OLD.status = 'active' AND NEW.status IN ('left','removed')
BEGIN
  DELETE FROM item_circles
   WHERE circle_id = NEW.circle_id
     AND item_id IN (SELECT id FROM items WHERE owner_id = NEW.user_id);
END;

-- Circle history: who invited, joined, left, removed, shared. Append-only.
CREATE TABLE circle_events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id  TEXT NOT NULL REFERENCES circles(id),
  actor_id   TEXT REFERENCES users(id),
  subject_id TEXT REFERENCES users(id),
  type       TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX circle_events_circle_idx ON circle_events(circle_id, seq);
CREATE TRIGGER circle_events_append_only_u BEFORE UPDATE ON circle_events
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER circle_events_append_only_d BEFORE DELETE ON circle_events
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

-- Who can ask to borrow an item. Existing items stay open to everyone.
ALTER TABLE items ADD COLUMN audience TEXT NOT NULL DEFAULT 'everyone'
  CHECK (audience IN ('everyone','circles'));

-- The circle whose membership let the borrower ask. NULL for open items.
ALTER TABLE loans ADD COLUMN via_circle_id TEXT REFERENCES circles(id);

-- Guard: a NEW loan on a circle-only item needs the borrower to be an active
-- member of a circle the item is shared with, right now. This runs on INSERT
-- only: membership changes later never touch existing loans.
CREATE TRIGGER loans_circle_access
BEFORE INSERT ON loans
WHEN NEW.via_circle_id IS NOT NULL
  OR (SELECT audience FROM items WHERE id = NEW.item_id) = 'circles'
BEGIN
  SELECT RAISE(ABORT, 'CIRCLE_ONLY') WHERE NEW.via_circle_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM item_circles ic
      JOIN circle_members m ON m.circle_id = ic.circle_id
     WHERE ic.item_id = NEW.item_id AND ic.circle_id = NEW.via_circle_id
       AND m.user_id = NEW.borrower_id AND m.status = 'active');
END;

-- Guard: how a loan came about is part of its record and never changes.
CREATE TRIGGER loans_via_fixed
BEFORE UPDATE OF via_circle_id ON loans
WHEN OLD.via_circle_id IS NOT NEW.via_circle_id
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FIELD');
END;
