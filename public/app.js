'use strict';

const messagesEl = document.getElementById('messages');
const composer = document.getElementById('composer');
const input = document.getElementById('input');

// Client-side cache van berichten (id -> msg).
const messages = new Map();

/* ---------- Helpers ---------- */
function formatTime(ms) {
  const d = new Date(ms);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const time = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) + ' ' + time;
}

function isAtBottom() {
  const m = document.querySelector('main');
  return m.scrollHeight - m.scrollTop - m.clientHeight < 60;
}

function scrollToBottom() {
  const m = document.querySelector('main');
  m.scrollTop = m.scrollHeight;
}

async function apiError(res) {
  const err = await res.json().catch(() => ({}));
  return err.error || 'Er ging iets mis.';
}

/* ---------- Bericht renderen ---------- */
function buildMessageEl(msg) {
  const el = document.createElement('div');
  el.className = 'message';
  el.dataset.id = msg.id;
  renderMessageView(el, msg);
  return el;
}

function renderMessageView(el, msg) {
  el.innerHTML = '';
  el.classList.remove('editing');

  const text = document.createElement('div');
  text.className = 'message-text';
  text.textContent = msg.content;
  el.appendChild(text);

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = formatTime(msg.created_at);
  if (msg.edited_at) {
    const edited = document.createElement('span');
    edited.className = 'edited-label';
    edited.textContent = ' (bewerkt)';
    meta.appendChild(edited);
  }
  el.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  actions.appendChild(makeBtn('Bewerk', () => renderMessageEdit(el, msg)));
  actions.appendChild(makeBtn('Verwijder', () => deleteMessage(msg.id)));
  el.appendChild(actions);
}

function renderMessageEdit(el, msg) {
  el.innerHTML = '';
  el.classList.add('editing');

  const ta = document.createElement('textarea');
  ta.className = 'edit-textarea';
  ta.value = msg.content;
  el.appendChild(ta);

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  actions.appendChild(
    makeBtn('Opslaan', () => saveMessageEdit(msg.id, ta.value)),
  );
  actions.appendChild(
    makeBtn('Annuleer', () => renderMessageView(el, messages.get(msg.id) || msg)),
  );
  el.appendChild(actions);

  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function makeBtn(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/* ---------- Lijst-bewerkingen ---------- */
function addMessage(msg) {
  messages.set(msg.id, msg);
  if (messagesEl.querySelector(`.message[data-id="${msg.id}"]`)) return;
  const stick = isAtBottom();
  messagesEl.appendChild(buildMessageEl(msg));
  if (stick) scrollToBottom();
}

function updateMessage(msg) {
  messages.set(msg.id, msg);
  const el = messagesEl.querySelector(`.message[data-id="${msg.id}"]`);
  if (!el) return;
  // Niet overschrijven als deze client het bericht op dat moment bewerkt.
  if (el.classList.contains('editing')) return;
  renderMessageView(el, msg);
}

function removeMessage(id) {
  messages.delete(id);
  const el = messagesEl.querySelector(`.message[data-id="${id}"]`);
  if (el) el.remove();
}

/* ---------- API-acties ---------- */
async function loadMessages() {
  const res = await fetch('/api/messages');
  const rows = await res.json();
  messagesEl.innerHTML = '';
  messages.clear();
  for (const msg of rows) {
    messages.set(msg.id, msg);
    messagesEl.appendChild(buildMessageEl(msg));
  }
  scrollToBottom();
}

async function sendMessage() {
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  autoGrow();
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      alert(await apiError(res));
      input.value = content;
    }
  } catch {
    alert('Versturen mislukt: geen verbinding.');
    input.value = content;
  }
}

async function saveMessageEdit(id, raw) {
  const content = raw.trim();
  if (!content) return;
  try {
    const res = await fetch(`/api/messages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      alert(await apiError(res));
      return;
    }
    // Eigen client verlaat de edit-modus direct; andere clients
    // krijgen dezelfde update via SSE (message:edit).
    const updated = await res.json();
    messages.set(updated.id, updated);
    const el = messagesEl.querySelector(`.message[data-id="${updated.id}"]`);
    if (el) renderMessageView(el, updated);
  } catch {
    alert('Bewerken mislukt: geen verbinding.');
  }
}

async function deleteMessage(id) {
  try {
    const res = await fetch(`/api/messages/${id}`, { method: 'DELETE' });
    if (!res.ok) alert(await apiError(res));
    // Bij succes komt de verwijdering via SSE binnen.
  } catch {
    alert('Verwijderen mislukt: geen verbinding.');
  }
}

/* ---------- Composer ---------- */
composer.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage();
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    sendMessage();
  }
});

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}
input.addEventListener('input', autoGrow);

/* ---------- Real-time (SSE) ---------- */
function connectSSE() {
  const source = new EventSource('/events');
  source.addEventListener('message:new', (e) => addMessage(JSON.parse(e.data)));
  source.addEventListener('message:edit', (e) => updateMessage(JSON.parse(e.data)));
  source.addEventListener('message:delete', (e) => removeMessage(JSON.parse(e.data).id));
}

/* ---------- Init ---------- */
loadMessages();
connectSSE();
