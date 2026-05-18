'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { db, UPLOADS_DIR } = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

/* ---------- Upload-config (multer) ---------- */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
// Toegestane mimetypes -> bestandsextensie. image/jpeg dekt jpg én jpeg.
const ALLOWED_IMAGE_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    // UUID-bestandsnaam (geen originele naam: security + geen collisions).
    filename: (req, file, cb) => {
      const ext = ALLOWED_IMAGE_TYPES[file.mimetype] || '.bin';
      cb(null, crypto.randomUUID() + ext);
    },
  }),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      const err = new Error('Alleen png, jpg, jpeg, gif of webp toegestaan.');
      err.code = 'INVALID_FILE_TYPE';
      cb(err);
    }
  },
}).single('image');

/* ---------- SSE ---------- */
const clients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Heartbeat zodat proxies de SSE-verbinding niet sluiten.
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25000);

/* ---------- Berichten ---------- */
app.get('/api/messages', (req, res) => {
  const rows = db.prepare('SELECT * FROM messages ORDER BY id ASC').all();
  res.json(rows);
});

app.post('/api/messages', (req, res) => {
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content) {
    return res.status(400).json({ error: 'Bericht mag niet leeg zijn.' });
  }
  const info = db
    .prepare('INSERT INTO messages (type, content, created_at) VALUES (?, ?, ?)')
    .run('text', content, Date.now());
  const msg = db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(Number(info.lastInsertRowid));
  broadcast('message:new', msg);
  res.status(201).json(msg);
});

app.post('/api/messages/image', (req, res) => {
  upload(req, res, (err) => {
    if (err) {
      // Eventueel deels weggeschreven bestand opruimen.
      if (req.file && req.file.path) {
        fs.promises.unlink(req.file.path).catch(() => {});
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Afbeelding is te groot (max 10MB).' });
      }
      if (err.code === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: 'Upload mislukt.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Geen afbeelding ontvangen.' });
    }
    const info = db
      .prepare(
        `INSERT INTO messages (type, image_path, image_mime, image_size, created_at)
         VALUES ('image', ?, ?, ?, ?)`,
      )
      .run(req.file.filename, req.file.mimetype, req.file.size, Date.now());
    const msg = db
      .prepare('SELECT * FROM messages WHERE id = ?')
      .get(Number(info.lastInsertRowid));
    broadcast('message:new', msg);
    res.status(201).json(msg);
  });
});

app.patch('/api/messages/:id', (req, res) => {
  const id = Number(req.params.id);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (!msg) {
    return res.status(404).json({ error: 'Bericht niet gevonden.' });
  }
  if (msg.type !== 'text') {
    return res.status(400).json({ error: 'Alleen tekstberichten kunnen bewerkt worden.' });
  }
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content) {
    return res.status(400).json({ error: 'Bericht mag niet leeg zijn.' });
  }
  db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?')
    .run(content, Date.now(), id);
  const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  broadcast('message:edit', updated);
  res.json(updated);
});

app.delete('/api/messages/:id', (req, res) => {
  const id = Number(req.params.id);
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (!msg) {
    return res.status(404).json({ error: 'Bericht niet gevonden.' });
  }
  db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  // Hard delete: bij een afbeelding ook het bestand van schijf verwijderen.
  if (msg.type === 'image' && msg.image_path) {
    fs.promises.unlink(path.join(UPLOADS_DIR, msg.image_path)).catch(() => {});
  }
  broadcast('message:delete', { id });
  res.json({ ok: true });
});

/* ---------- To-do's ---------- */
// Nieuwste boven (id DESC): net toegevoegde items direct zichtbaar.
app.get('/api/todos', (req, res) => {
  res.json(db.prepare('SELECT * FROM todos ORDER BY id DESC').all());
});

app.post('/api/todos', (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ error: 'To-do mag niet leeg zijn.' });
  }
  const info = db
    .prepare('INSERT INTO todos (text, created_at) VALUES (?, ?)')
    .run(text, Date.now());
  const todo = db
    .prepare('SELECT * FROM todos WHERE id = ?')
    .get(Number(info.lastInsertRowid));
  broadcast('todo:new', todo);
  res.status(201).json(todo);
});

app.patch('/api/todos/:id', (req, res) => {
  const id = Number(req.params.id);
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  if (!todo) {
    return res.status(404).json({ error: 'To-do niet gevonden.' });
  }

  // Afvinken/uitvinken: raakt done + completed_at, niet de tekst.
  if (typeof req.body.done === 'boolean') {
    const done = req.body.done ? 1 : 0;
    const completedAt = done ? Date.now() : null;
    db.prepare('UPDATE todos SET done = ?, completed_at = ? WHERE id = ?')
      .run(done, completedAt, id);
    const updated = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    broadcast('todo:toggle', updated);
    return res.json(updated);
  }

  // Tekst bewerken: raakt text + edited_at, niet done/completed_at.
  if (typeof req.body.text === 'string') {
    const text = req.body.text.trim();
    if (!text) {
      return res.status(400).json({ error: 'To-do mag niet leeg zijn.' });
    }
    db.prepare('UPDATE todos SET text = ?, edited_at = ? WHERE id = ?')
      .run(text, Date.now(), id);
    const updated = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    broadcast('todo:edit', updated);
    return res.json(updated);
  }

  return res.status(400).json({ error: 'Niets om bij te werken.' });
});

app.delete('/api/todos/:id', (req, res) => {
  const id = Number(req.params.id);
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  if (!todo) {
    return res.status(404).json({ error: 'To-do niet gevonden.' });
  }
  db.prepare('DELETE FROM todos WHERE id = ?').run(id);
  broadcast('todo:delete', { id });
  res.json({ ok: true });
});

/* ---------- Start ---------- */
// Poort: env PORT, anders 1e CLI-argument, anders 3000.
const PORT = process.env.PORT || process.argv[2] || 3000;
app.listen(PORT, () => {
  console.log(`Speakeasy draait op http://localhost:${PORT}`);
});
