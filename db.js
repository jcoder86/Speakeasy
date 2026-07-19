'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// Data-pad: env DATA_DIR (Docker: /data), lokaal: ./data
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'chat.db'));

// Foreign keys aanzetten (default off in SQLite) — nodig voor cascade delete
// van todo_labels bij delete van een label of todo.
db.exec('PRAGMA foreign_keys = ON');

// Volledig schema in één keer (idempotent via IF NOT EXISTS).
// Nieuwe tabellen zijn additief; bestaande data blijft ongemoeid.
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL DEFAULT 'text',
    content     TEXT,
    image_path  TEXT,
    image_mime  TEXT,
    image_size  INTEGER,
    created_at  INTEGER NOT NULL,
    edited_at   INTEGER
  );

  CREATE TABLE IF NOT EXISTS todos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    text         TEXT    NOT NULL,
    done         INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    edited_at    INTEGER,
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS labels (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT    NOT NULL UNIQUE,
    color TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS todo_labels (
    todo_id  INTEGER NOT NULL,
    label_id INTEGER NOT NULL,
    PRIMARY KEY (todo_id, label_id),
    FOREIGN KEY (todo_id)  REFERENCES todos(id)  ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_todo_labels_label ON todo_labels(label_id);

  CREATE TABLE IF NOT EXISTS watchlist (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker       TEXT    NOT NULL UNIQUE,
    display_name TEXT,
    added_at     INTEGER NOT NULL
  );

  -- Dagelijkse close-prijzen (accumuleert vanuit /quote-calls) voor
  -- deltas 5d/21d/63d/YTD. Datum in YYYY-MM-DD (UTC).
  CREATE TABLE IF NOT EXISTS prices (
    ticker TEXT NOT NULL,
    date   TEXT NOT NULL,
    close  REAL NOT NULL,
    PRIMARY KEY (ticker, date)
  );
  CREATE INDEX IF NOT EXISTS idx_prices_ticker_date ON prices(ticker, date DESC);

  -- Dagelijkse snapshot van spaar-/hypotheekrente, voor een indicatieve
  -- trendgrafiek (zie rates.js). Begint leeg; bouwt zich vanaf nu op.
  CREATE TABLE IF NOT EXISTS rate_history (
    metric TEXT NOT NULL,
    date   TEXT NOT NULL,
    rate   REAL NOT NULL,
    PRIMARY KEY (metric, date)
  );
  CREATE INDEX IF NOT EXISTS idx_rate_history_metric_date ON rate_history(metric, date DESC);
`);

// --- Additieve migratie: watchlist.position voor handmatige volgorde ---
// ALTER TABLE ADD COLUMN faalt als de kolom al bestaat, dus eerst checken.
const wlCols = db.prepare('PRAGMA table_info(watchlist)').all();
if (!wlCols.some((c) => c.name === 'position')) {
  db.exec('ALTER TABLE watchlist ADD COLUMN position INTEGER');
  // Bestaande rijen krijgen een positie in hun huidige volgorde (added_at).
  const rows = db.prepare('SELECT id FROM watchlist ORDER BY added_at ASC, id ASC').all();
  const upd = db.prepare('UPDATE watchlist SET position = ? WHERE id = ?');
  rows.forEach((r, i) => upd.run(i, r.id));
}

// --- Additieve migratie: todos.position voor handmatige volgorde ---
const todoCols = db.prepare('PRAGMA table_info(todos)').all();
if (!todoCols.some((c) => c.name === 'position')) {
  db.exec('ALTER TABLE todos ADD COLUMN position INTEGER');
  // Bestaande rijen krijgen een positie die de huidige "nieuwste boven"
  // volgorde (id DESC) behoudt, zodat de migratie niets omgooit.
  const rows = db.prepare('SELECT id FROM todos ORDER BY id DESC').all();
  const upd = db.prepare('UPDATE todos SET position = ? WHERE id = ?');
  rows.forEach((r, i) => upd.run(i, r.id));
}

// --- Additieve migratie: todos.color (kaart-achtergrond, via bewerken) ---
if (!todoCols.some((c) => c.name === 'color')) {
  db.exec('ALTER TABLE todos ADD COLUMN color TEXT');
}

module.exports = { db, DATA_DIR, UPLOADS_DIR };
