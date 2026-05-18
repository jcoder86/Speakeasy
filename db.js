'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// Data-pad: env DATA_DIR (Docker: /data), lokaal: ./data
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'chat.db'));

// Volledig schema in één keer (idempotent via IF NOT EXISTS).
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
`);

module.exports = { db, DATA_DIR, UPLOADS_DIR };
