'use strict';

const path = require('node:path');
const express = require('express');
const { db } = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

/* ---------- Start ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Speakeasy draait op http://localhost:${PORT}`);
});
