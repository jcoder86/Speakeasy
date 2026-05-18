'use strict';

const messagesEl = document.getElementById('messages');
const composer = document.getElementById('composer');
const input = document.getElementById('input');

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

/* ---------- Rendering ---------- */
function renderMessage(msg) {
  const el = document.createElement('div');
  el.className = 'message';
  el.dataset.id = msg.id;

  const text = document.createElement('div');
  text.className = 'message-text';
  text.textContent = msg.content;
  el.appendChild(text);

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = formatTime(msg.created_at);
  el.appendChild(meta);

  return el;
}

function addMessage(msg) {
  if (messagesEl.querySelector(`.message[data-id="${msg.id}"]`)) return;
  const stick = isAtBottom();
  messagesEl.appendChild(renderMessage(msg));
  if (stick) scrollToBottom();
}

/* ---------- Laden ---------- */
async function loadMessages() {
  const res = await fetch('/api/messages');
  const rows = await res.json();
  messagesEl.innerHTML = '';
  for (const msg of rows) messagesEl.appendChild(renderMessage(msg));
  scrollToBottom();
}

/* ---------- Versturen ---------- */
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
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Versturen mislukt.');
      input.value = content;
    }
  } catch {
    alert('Versturen mislukt: geen verbinding.');
    input.value = content;
  }
}

composer.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage();
});

// Ctrl/Cmd+Enter verstuurt; gewone Enter = nieuwe regel.
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    sendMessage();
  }
});

/* ---------- Auto-grow textarea ---------- */
function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}
input.addEventListener('input', autoGrow);

/* ---------- Real-time (SSE) ---------- */
function connectSSE() {
  const source = new EventSource('/events');
  source.addEventListener('message:new', (e) => {
    addMessage(JSON.parse(e.data));
  });
  source.onerror = () => {
    // EventSource reconnect automatisch; niets te doen.
  };
}

/* ---------- Init ---------- */
loadMessages();
connectSSE();
