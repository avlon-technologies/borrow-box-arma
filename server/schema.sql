-- BorrowBox schema. Business rules that must never be violated are enforced
-- here as well as in the domain layer, so that no code path (or concurrent
-- process) can break them.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  first_name    TEXT NOT NULL,
  neighbourhood TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  avatar_hue    INTEGER NOT NULL DEFAULT 20,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id          TEXT PRIMARY KEY,
  uploader_id TEXT NOT NULL REFERENCES users(id),
  file_name   TEXT NOT NULL,
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL,
  image_url     TEXT,
  max_days      INTEGER NOT NULL CHECK (max_days BETWEEN 1 AND 60),
  pickup_notes  TEXT NOT NULL DEFAULT '',
  care_notes    TEXT NOT NULL DEFAULT '',
  hidden        INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- A loan is one borrowing story, from first request to return.
-- Dates are calendar days (YYYY-MM-DD) in the community time zone and are
-- inclusive at both ends.
CREATE TABLE IF NOT EXISTS loans (
  id                TEXT PRIMARY KEY,
  item_id           TEXT NOT NULL REFERENCES items(id),
  borrower_id       TEXT NOT NULL REFERENCES users(id),
  owner_id          TEXT NOT NULL REFERENCES users(id),
  status            TEXT NOT NULL CHECK (status IN
                      ('requested','approved','ready','borrowed','returning','returned','declined','cancelled')),
  start_date        TEXT NOT NULL,
  end_date          TEXT NOT NULL,
  original_end_date TEXT NOT NULL,
  note              TEXT NOT NULL DEFAULT '',
  picked_up_at      TEXT,
  returned_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  CHECK (start_date <= end_date),
  CHECK (borrower_id <> owner_id)
);
CREATE INDEX IF NOT EXISTS loans_item_idx ON loans(item_id, status);
CREATE INDEX IF NOT EXISTS loans_borrower_idx ON loans(borrower_id);
CREATE INDEX IF NOT EXISTS loans_owner_idx ON loans(owner_id);

-- Guard: two loans that hold the item ("approved" through "returning") may
-- never overlap. Pending requests are allowed to overlap freely.
CREATE TRIGGER IF NOT EXISTS loans_no_overlap_insert
BEFORE INSERT ON loans
WHEN NEW.status IN ('approved','ready','borrowed','returning')
BEGIN
  SELECT RAISE(ABORT, 'BOOKING_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM loans o
     WHERE o.item_id = NEW.item_id AND o.id <> NEW.id
       AND o.status IN ('approved','ready','borrowed','returning')
       AND o.start_date <= NEW.end_date AND NEW.start_date <= o.end_date);
END;

CREATE TRIGGER IF NOT EXISTS loans_no_overlap_update
BEFORE UPDATE OF status, start_date, end_date ON loans
WHEN NEW.status IN ('approved','ready','borrowed','returning')
BEGIN
  SELECT RAISE(ABORT, 'BOOKING_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM loans o
     WHERE o.item_id = NEW.item_id AND o.id <> NEW.id
       AND o.status IN ('approved','ready','borrowed','returning')
       AND o.start_date <= NEW.end_date AND NEW.start_date <= o.end_date);
END;

-- Guard: only legal lifecycle transitions.
CREATE TRIGGER IF NOT EXISTS loans_legal_transition
BEFORE UPDATE OF status ON loans
WHEN OLD.status <> NEW.status AND NOT (
     (OLD.status = 'requested' AND NEW.status IN ('approved','declined','cancelled'))
  OR (OLD.status = 'approved'  AND NEW.status IN ('ready','cancelled'))
  OR (OLD.status = 'ready'     AND NEW.status IN ('borrowed','cancelled'))
  OR (OLD.status = 'borrowed'  AND NEW.status IN ('returning','returned'))
  OR (OLD.status = 'returning' AND NEW.status IN ('returned'))
)
BEGIN
  SELECT RAISE(ABORT, 'ILLEGAL_TRANSITION');
END;

-- Guard: the people on a loan never change.
CREATE TRIGGER IF NOT EXISTS loans_parties_fixed
BEFORE UPDATE OF item_id, borrower_id, owner_id, start_date, original_end_date ON loans
WHEN OLD.item_id <> NEW.item_id OR OLD.borrower_id <> NEW.borrower_id
  OR OLD.owner_id <> NEW.owner_id OR OLD.start_date <> NEW.start_date
  OR OLD.original_end_date <> NEW.original_end_date
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FIELD');
END;

CREATE TABLE IF NOT EXISTS extensions (
  id             TEXT PRIMARY KEY,
  loan_id        TEXT NOT NULL REFERENCES loans(id),
  requested_by   TEXT NOT NULL REFERENCES users(id),
  from_end_date  TEXT NOT NULL,
  new_end_date   TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','withdrawn')),
  response_note  TEXT NOT NULL DEFAULT '',
  decided_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL,
  decided_at     TEXT,
  CHECK (new_end_date > from_end_date)
);
-- At most one open extension proposal per loan.
CREATE UNIQUE INDEX IF NOT EXISTS extensions_one_pending
  ON extensions(loan_id) WHERE status = 'pending';

CREATE TRIGGER IF NOT EXISTS extensions_decide_once
BEFORE UPDATE ON extensions
WHEN OLD.status <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'ILLEGAL_TRANSITION');
END;

-- Condition evidence: each person's account is a separate, immutable record.
CREATE TABLE IF NOT EXISTS condition_reports (
  id         TEXT PRIMARY KEY,
  loan_id    TEXT NOT NULL REFERENCES loans(id),
  author_id  TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL CHECK (role IN ('owner','borrower')),
  phase      TEXT NOT NULL CHECK (phase IN ('handoff','return','followup')),
  condition  TEXT NOT NULL CHECK (condition IN ('like_new','good','worn','damaged','missing_parts')),
  agrees     INTEGER CHECK (agrees IN (0, 1)),
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS condition_reports_loan_idx ON condition_reports(loan_id);

CREATE TABLE IF NOT EXISTS report_photos (
  report_id TEXT NOT NULL REFERENCES condition_reports(id),
  upload_id TEXT NOT NULL REFERENCES uploads(id),
  position  INTEGER NOT NULL,
  PRIMARY KEY (report_id, upload_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  loan_id    TEXT NOT NULL REFERENCES loans(id),
  author_id  TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_loan_idx ON messages(loan_id);

-- Audit trail: who did what, when. Append-only.
CREATE TABLE IF NOT EXISTS loan_events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id    TEXT NOT NULL REFERENCES loans(id),
  actor_id   TEXT REFERENCES users(id),
  type       TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS loan_events_loan_idx ON loan_events(loan_id, seq);

-- Remembered responses for retried / double-submitted writes.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id     TEXT NOT NULL,
  key         TEXT NOT NULL,
  route       TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TRIGGER IF NOT EXISTS condition_reports_append_only_u BEFORE UPDATE ON condition_reports
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS condition_reports_append_only_d BEFORE DELETE ON condition_reports
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS report_photos_append_only_u BEFORE UPDATE ON report_photos
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS report_photos_append_only_d BEFORE DELETE ON report_photos
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS loan_events_append_only_u BEFORE UPDATE ON loan_events
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS loan_events_append_only_d BEFORE DELETE ON loan_events
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS messages_append_only_u BEFORE UPDATE ON messages
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS messages_append_only_d BEFORE DELETE ON messages
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
