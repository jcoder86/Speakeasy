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

/* ---------- Labels ---------- */
// Palette voor default-kleur als de client er geen meegeeft.
const DEFAULT_LABEL_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

function isValidHexColor(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

app.get('/api/labels', (req, res) => {
  res.json(db.prepare('SELECT * FROM labels ORDER BY name COLLATE NOCASE').all());
});

app.post('/api/labels', (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Label mag niet leeg zijn.' });
  if (name.length > 40) return res.status(400).json({ error: 'Label is te lang (max 40 tekens).' });
  const color = isValidHexColor(req.body.color)
    ? req.body.color
    : DEFAULT_LABEL_COLORS[Math.floor(Math.random() * DEFAULT_LABEL_COLORS.length)];
  try {
    const info = db
      .prepare('INSERT INTO labels (name, color) VALUES (?, ?)')
      .run(name, color);
    const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(Number(info.lastInsertRowid));
    broadcast('label:new', label);
    res.status(201).json(label);
  } catch (err) {
    if (err && String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Label met deze naam bestaat al.' });
    }
    throw err;
  }
});

app.delete('/api/labels/:id', (req, res) => {
  const id = Number(req.params.id);
  const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(id);
  if (!label) return res.status(404).json({ error: 'Label niet gevonden.' });
  // Welke todos raakten dit label kwijt? Vóór delete ophalen zodat we
  // deze clients de bijgewerkte todos kunnen sturen (met minder labels).
  const affectedTodoIds = db
    .prepare('SELECT DISTINCT todo_id FROM todo_labels WHERE label_id = ?')
    .all(id)
    .map((r) => r.todo_id);
  db.prepare('DELETE FROM labels WHERE id = ?').run(id);
  broadcast('label:delete', { id });
  // Gerelateerde todos opnieuw broadcasten zodat chips verdwijnen.
  for (const tid of affectedTodoIds) {
    const updated = getTodoWithLabels(tid);
    if (updated) broadcast('todo:edit', updated);
  }
  res.json({ ok: true });
});

/* ---------- To-do's ---------- */
// Nieuwste boven (id DESC): net toegevoegde items direct zichtbaar.

// Haalt één todo op met bijbehorende labels-array (of null als niet gevonden).
function getTodoWithLabels(id) {
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  if (!todo) return null;
  todo.labels = db
    .prepare(
      `SELECT l.id, l.name, l.color
         FROM todo_labels tl
         JOIN labels l ON l.id = tl.label_id
        WHERE tl.todo_id = ?
        ORDER BY l.name COLLATE NOCASE`,
    )
    .all(id);
  return todo;
}

// Vervangt de label-set van een todo. Transactioneel zodat een
// mislukte insert de bestaande labels niet weghaalt.
function setTodoLabels(todoId, labelIds) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM todo_labels WHERE todo_id = ?').run(todoId);
    if (labelIds && labelIds.length) {
      const ins = db.prepare('INSERT OR IGNORE INTO todo_labels (todo_id, label_id) VALUES (?, ?)');
      for (const lid of labelIds) ins.run(todoId, Number(lid));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

app.get('/api/todos', (req, res) => {
  // Twee queries, geen N+1: één voor todos, één voor alle todo_labels-joins.
  const todos = db.prepare('SELECT * FROM todos ORDER BY id DESC').all();
  const rows = db
    .prepare(
      `SELECT tl.todo_id, l.id, l.name, l.color
         FROM todo_labels tl
         JOIN labels l ON l.id = tl.label_id
        ORDER BY l.name COLLATE NOCASE`,
    )
    .all();
  const byTodo = new Map();
  for (const r of rows) {
    if (!byTodo.has(r.todo_id)) byTodo.set(r.todo_id, []);
    byTodo.get(r.todo_id).push({ id: r.id, name: r.name, color: r.color });
  }
  for (const t of todos) t.labels = byTodo.get(t.id) || [];
  res.json(todos);
});

app.post('/api/todos', (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ error: 'To-do mag niet leeg zijn.' });
  }
  const info = db
    .prepare('INSERT INTO todos (text, created_at) VALUES (?, ?)')
    .run(text, Date.now());
  // Optioneel labels meesturen bij aanmaken.
  const id = Number(info.lastInsertRowid);
  if (Array.isArray(req.body.labels) && req.body.labels.length) {
    setTodoLabels(id, req.body.labels);
  }
  const todo = getTodoWithLabels(id);
  broadcast('todo:new', todo);
  res.status(201).json(todo);
});

app.patch('/api/todos/:id', (req, res) => {
  const id = Number(req.params.id);
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  if (!todo) {
    return res.status(404).json({ error: 'To-do niet gevonden.' });
  }

  const hasDone = typeof req.body.done === 'boolean';
  const hasText = typeof req.body.text === 'string';
  const hasLabels = Array.isArray(req.body.labels);
  if (!hasDone && !hasText && !hasLabels) {
    return res.status(400).json({ error: 'Niets om bij te werken.' });
  }

  // Afvinken/uitvinken: raakt done + completed_at, niet de tekst.
  if (hasDone) {
    const done = req.body.done ? 1 : 0;
    const completedAt = done ? Date.now() : null;
    db.prepare('UPDATE todos SET done = ?, completed_at = ? WHERE id = ?')
      .run(done, completedAt, id);
  }

  // Tekst bewerken: raakt text + edited_at, niet done/completed_at.
  if (hasText) {
    const text = req.body.text.trim();
    if (!text) {
      return res.status(400).json({ error: 'To-do mag niet leeg zijn.' });
    }
    db.prepare('UPDATE todos SET text = ?, edited_at = ? WHERE id = ?')
      .run(text, Date.now(), id);
  }

  // Label-set vervangen. Blijft los van text/done zoals de spec vereist.
  if (hasLabels) {
    setTodoLabels(id, req.body.labels);
  }

  const updated = getTodoWithLabels(id);
  // Bij een enkelvoudige toggle (geen tekst/labels) blijft het semantisch een
  // toggle-event; andere clients kunnen dan aparte animatie tonen indien nodig.
  const event = hasDone && !hasText && !hasLabels ? 'todo:toggle' : 'todo:edit';
  broadcast(event, updated);
  res.json(updated);
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
