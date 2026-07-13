'use strict';

const messagesEl = document.getElementById('messages');
const todosEl = document.getElementById('todos');
const todoEmptyEl = document.getElementById('todo-empty');
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const addTodoBtn = document.getElementById('addtodo-btn');
const uploadBtn = document.getElementById('upload-btn');
const imageInput = document.getElementById('image-input');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const navButtons = document.querySelectorAll('.nav-btn');

// Client-side caches (id -> object).
const messages = new Map();
const todos = new Map();

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

function makeBtn(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/* ---------- View-toggle (tabs) ---------- */
// Drie tabs: feed | todo | chat. Op mobiel is er per data-view één view
// zichtbaar; op desktop toont de "Dashboard"-knop (target: feed) zowel
// feed als to-do naast elkaar — de CSS regelt dat via [data-view].
function setView(view) {
  document.body.dataset.view = view;
  for (const btn of navButtons) {
    const t = btn.dataset.viewTarget;
    const isDesktopBtn = btn.closest('#desktop-nav') !== null;
    // Desktop "Dashboard"-knop (target=feed) blijft ook actief bij view=todo.
    const active = t === view || (isDesktopBtn && t === 'feed' && view === 'todo');
    btn.classList.toggle('active', active);
  }
  if (view === 'chat') input.focus();
}

for (const btn of navButtons) {
  btn.addEventListener('click', () => setView(btn.dataset.viewTarget));
}

/* ===================================================================
   CHAT-BERICHTEN
   =================================================================== */
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
  el.classList.toggle('image-message', msg.type === 'image');

  const actions = document.createElement('div');
  actions.className = 'item-actions';

  if (msg.type === 'image') {
    const src = '/uploads/' + msg.image_path;
    const img = document.createElement('img');
    img.className = 'message-image';
    img.src = src;
    img.alt = 'Afbeelding';
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(src));
    el.appendChild(img);
    // Afbeeldingsbericht: kopiëren + verwijderen (geen bewerken).
    actions.appendChild(makeBtn('Kopieer', () => copyImage(src)));
  } else {
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = msg.content;
    el.appendChild(text);
    // Tekstbericht: bewerken + verwijderen.
    actions.appendChild(makeBtn('Bewerk', () => renderMessageEdit(el, msg)));
  }

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
  actions.appendChild(makeBtn('Opslaan', () => saveMessageEdit(msg.id, ta.value)));
  actions.appendChild(
    makeBtn('Annuleer', () => renderMessageView(el, messages.get(msg.id) || msg)),
  );
  el.appendChild(actions);

  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

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
  if (el.classList.contains('editing')) return; // niet clobberen tijdens edit
  renderMessageView(el, msg);
}

function removeMessage(id) {
  messages.delete(id);
  const el = messagesEl.querySelector(`.message[data-id="${id}"]`);
  if (el) el.remove();
}

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
  } catch {
    alert('Verwijderen mislukt: geen verbinding.');
  }
}

/* ===================================================================
   AFBEELDINGEN
   =================================================================== */
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function uploadImage(file) {
  if (!file) return;
  // Client-side voorcontrole (server valideert nogmaals, autoritair).
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    alert('Alleen png, jpg, jpeg, gif of webp toegestaan.');
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    alert('Afbeelding is te groot (max 10MB).');
    return;
  }
  const fd = new FormData();
  fd.append('image', file);
  try {
    const res = await fetch('/api/messages/image', { method: 'POST', body: fd });
    if (!res.ok) alert(await apiError(res));
    // Bij succes komt het bericht via SSE binnen.
  } catch {
    alert('Upload mislukt: geen verbinding.');
  }
}

/* ---------- Lightbox ---------- */
function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.hidden = false;
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImg.removeAttribute('src');
}

lightbox.addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
});

/* ---------- Kopiëren naar klembord ---------- */
// Browsers ondersteunen op het klembord betrouwbaar alleen image/png;
// jpg/gif/webp worden daarom eerst via een canvas naar PNG geconverteerd.
function blobToPng(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('conversie mislukt'))),
        'image/png',
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('afbeelding laden mislukt'));
    };
    img.src = url;
  });
}

async function copyImage(src) {
  try {
    const resp = await fetch(src);
    let blob = await resp.blob();
    if (blob.type !== 'image/png') {
      blob = await blobToPng(blob);
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch (err) {
    alert('Kopiëren naar klembord mislukt: ' + (err && err.message ? err.message : err));
  }
}

/* ===================================================================
   TO-DO'S
   =================================================================== */
function updateTodoEmptyHint() {
  todoEmptyEl.hidden = todos.size > 0;
}

function buildTodoEl(todo) {
  const el = document.createElement('div');
  el.className = 'todo';
  el.dataset.id = todo.id;
  renderTodoView(el, todo);
  return el;
}

function renderTodoView(el, todo) {
  el.innerHTML = '';
  el.classList.remove('editing');
  el.classList.toggle('done', !!todo.done);

  // Checkbox in 44x44 label-wrapper als tap-target.
  const checkWrap = document.createElement('label');
  checkWrap.className = 'todo-check-wrap';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'todo-check';
  check.checked = !!todo.done;
  check.addEventListener('change', () => toggleTodo(todo.id, check.checked));
  checkWrap.appendChild(check);
  el.appendChild(checkWrap);

  const body = document.createElement('div');
  body.className = 'todo-body';

  const text = document.createElement('div');
  text.className = 'todo-text';
  text.textContent = todo.text;
  body.appendChild(text);

  const meta = document.createElement('div');
  meta.className = 'todo-meta';
  meta.textContent = formatTime(todo.created_at);
  if (todo.edited_at) {
    const edited = document.createElement('span');
    edited.className = 'edited-label';
    edited.textContent = ' (bewerkt)';
    meta.appendChild(edited);
  }
  body.appendChild(meta);
  el.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  actions.appendChild(makeBtn('Bewerk', () => renderTodoEdit(el, todo)));
  actions.appendChild(makeBtn('Verwijder', () => deleteTodo(todo.id)));
  el.appendChild(actions);
}

function renderTodoEdit(el, todo) {
  el.innerHTML = '';
  el.classList.add('editing');

  const ta = document.createElement('textarea');
  ta.className = 'edit-textarea';
  ta.value = todo.text;
  el.appendChild(ta);

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  actions.appendChild(makeBtn('Opslaan', () => saveTodoEdit(todo.id, ta.value)));
  actions.appendChild(
    makeBtn('Annuleer', () => renderTodoView(el, todos.get(todo.id) || todo)),
  );
  el.appendChild(actions);

  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function addTodo(todo) {
  todos.set(todo.id, todo);
  if (!todosEl.querySelector(`.todo[data-id="${todo.id}"]`)) {
    todosEl.prepend(buildTodoEl(todo)); // nieuwste boven
  }
  updateTodoEmptyHint();
}

function updateTodo(todo) {
  todos.set(todo.id, todo);
  const el = todosEl.querySelector(`.todo[data-id="${todo.id}"]`);
  if (!el) return;
  if (el.classList.contains('editing')) return; // niet clobberen tijdens edit
  renderTodoView(el, todo);
}

function removeTodo(id) {
  todos.delete(id);
  const el = todosEl.querySelector(`.todo[data-id="${id}"]`);
  if (el) el.remove();
  updateTodoEmptyHint();
}

async function loadTodos() {
  const res = await fetch('/api/todos');
  const rows = await res.json(); // al gesorteerd nieuwste-eerst
  todosEl.innerHTML = '';
  todos.clear();
  for (const todo of rows) {
    todos.set(todo.id, todo);
    todosEl.appendChild(buildTodoEl(todo));
  }
  updateTodoEmptyHint();
}

async function createTodo(text) {
  const value = text.trim();
  if (!value) return false;
  try {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: value }),
    });
    if (!res.ok) {
      alert(await apiError(res));
      return false;
    }
    return true;
  } catch {
    alert('Toevoegen mislukt: geen verbinding.');
    return false;
  }
}

async function toggleTodo(id, done) {
  try {
    const res = await fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done }),
    });
    if (!res.ok) alert(await apiError(res));
  } catch {
    alert('Bijwerken mislukt: geen verbinding.');
  }
}

async function saveTodoEdit(id, raw) {
  const text = raw.trim();
  if (!text) return;
  try {
    const res = await fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      alert(await apiError(res));
      return;
    }
    const updated = await res.json();
    todos.set(updated.id, updated);
    const el = todosEl.querySelector(`.todo[data-id="${updated.id}"]`);
    if (el) renderTodoView(el, updated);
  } catch {
    alert('Bewerken mislukt: geen verbinding.');
  }
}

async function deleteTodo(id) {
  try {
    const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' });
    if (!res.ok) alert(await apiError(res));
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

// "Add to-do": tekst uit de textarea wordt een to-do; textarea leegt;
// de gebruiker blijft in de chat-view (geen automatische switch).
addTodoBtn.addEventListener('click', async () => {
  if (!input.value.trim()) return;
  const ok = await createTodo(input.value);
  if (ok) {
    input.value = '';
    autoGrow();
  }
});

// Afbeelding uploaden via knop -> verborgen file-input.
uploadBtn.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', () => {
  if (imageInput.files[0]) uploadImage(imageInput.files[0]);
  imageInput.value = ''; // reset zodat dezelfde file opnieuw kan
});

// Plakken (Ctrl/Cmd+V) met een afbeelding op het klembord -> upload
// als afbeeldingsbericht i.p.v. base64-tekst in de textarea.
input.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        uploadImage(file);
      }
      return;
    }
  }
  // Geen afbeelding gevonden: normale tekst-paste laten doorgaan.
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
  source.addEventListener('todo:new', (e) => addTodo(JSON.parse(e.data)));
  source.addEventListener('todo:edit', (e) => updateTodo(JSON.parse(e.data)));
  source.addEventListener('todo:toggle', (e) => updateTodo(JSON.parse(e.data)));
  source.addEventListener('todo:delete', (e) => removeTodo(JSON.parse(e.data).id));
}

/* ---------- Init ---------- */
loadMessages();
loadTodos();
connectSSE();
setView('feed'); // default: dashboard/feed

/* ---------- PWA service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => console.warn('SW-registratie mislukt:', err));
  });
}
