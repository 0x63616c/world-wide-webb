import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// DB path: file by default, override with TYE_DB (e.g. ":memory:" for tests).
const DB_PATH = process.env.TYE_DB ?? new URL("../data/tye.sqlite", import.meta.url).pathname;

if (DB_PATH !== ":memory:") {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

export function initSchema() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    color        TEXT NOT NULL DEFAULT '#5E5CE6',
    emoji        TEXT,
    photo        TEXT,
    phone        TEXT,
    auth_provider TEXT NOT NULL DEFAULT 'demo',
    notif_prefs  TEXT NOT NULL DEFAULT '{"slips":true,"reports":true,"joins":false,"milestones":true}',
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_exes (
    id      TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jars (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    rule          TEXT NOT NULL DEFAULT '',
    default_cents INTEGER NOT NULL DEFAULT 500,
    currency      TEXT NOT NULL DEFAULT 'usd',
    created_by    TEXT NOT NULL REFERENCES users(id),
    invite_code   TEXT NOT NULL UNIQUE,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memberships (
    id             TEXT PRIMARY KEY,
    jar_id         TEXT NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role           TEXT NOT NULL DEFAULT 'member',
    tally_cents    INTEGER NOT NULL DEFAULT 0,
    streak_start_at INTEGER,
    share_streak   INTEGER NOT NULL DEFAULT 1,
    joined_at      INTEGER NOT NULL,
    UNIQUE(jar_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS slips (
    id          TEXT PRIMARY KEY,
    jar_id      TEXT NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id),
    amount_cents INTEGER NOT NULL,
    note        TEXT,
    ex_label    TEXT,
    source      TEXT NOT NULL DEFAULT 'self',
    reported_by TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reports (
    id           TEXT PRIMARY KEY,
    jar_id       TEXT NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
    accuser_id   TEXT NOT NULL REFERENCES users(id),
    accused_id   TEXT NOT NULL REFERENCES users(id),
    note         TEXT,
    is_anonymous INTEGER NOT NULL DEFAULT 0,
    amount_cents INTEGER NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   INTEGER NOT NULL,
    resolved_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS report_evidence (
    id        TEXT PRIMARY KEY,
    report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    kind      TEXT NOT NULL DEFAULT 'image',
    payload   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity (
    id          TEXT PRIMARY KEY,
    jar_id      TEXT NOT NULL REFERENCES jars(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    actor_id    TEXT,
    target_id   TEXT,
    text        TEXT,
    amount_cents INTEGER,
    ex_label    TEXT,
    note        TEXT,
    anonymous   INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );

  -- pretend OTP store (phone -> code), so the "check your texts" flow is real-ish
  CREATE TABLE IF NOT EXISTS otps (
    phone      TEXT PRIMARY KEY,
    code       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_membership_jar ON memberships(jar_id);
  CREATE INDEX IF NOT EXISTS idx_membership_user ON memberships(user_id);
  CREATE INDEX IF NOT EXISTS idx_activity_jar ON activity(jar_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_slip_jar ON slips(jar_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_report_accused ON reports(accused_id, status);
  `);
}

export const now = () => Date.now();
export const DAY = 86_400_000;
