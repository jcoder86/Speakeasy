'use strict';

const messagesEl = document.getElementById('messages');
const todosEl = document.getElementById('todos');
const todoEmptyEl = document.getElementById('todo-empty');
const chatView = document.getElementById('chat-view');
const todoView = document.getElementById('todo-view');
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const viewToggle = document.getElementById('view-toggle');
const addTodoBtn = document.getElementById('addtodo-btn');

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

/* ---------- View-toggle ---------- */
let currentView = 'chat';

function setView(view) {
  currentView = view;
  const isTodo = view === 'todo';
  chatView.hidden = isTodo;
  todoView.hidden = !isTodo;
  composer.hidden = isTodo;
  viewToggle.textContent = isTodo ? '← Chat' : 'To-do';
}

viewToggle.addEventListener('click', () => {
  setView(currentView === 'chat' ? 'todo' : 'chat');
});

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
