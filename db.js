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
`);

module.exports = { db, DATA_DIR, UPLOADS_DIR };
