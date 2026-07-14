'use strict';

const messagesEl = document.getElementById('messages');
const openTodosEl = document.getElementById('todos');
const doneTodosEl = document.getElementById('done-todos');
const doneCountEl = document.getElementById('done-count');
const doneSectionEl = document.getElementById('done-section');
const todoEmptyEl = document.getElementById('todo-empty');
const todoAddForm = document.getElementById('todo-add-form');
const todoAddInput = document.getElementById('todo-add-input');
const filterChipsEl = document.getElementById('filter-chips');
const filterClearBtn = document.getElementById('filter-clear');
const labelMgmtListEl = document.getElementById('label-mgmt-list');
const newLabelForm = document.getElementById('new-label-form');
const newLabelName = document.getElementById('new-label-name');
const newLabelColor = document.getElementById('new-label-color');
const quotesStatusEl = document.getElementById('quotes-status');
const quotesStripEl = document.getElementById('quotes-strip');
const watchlistListEl = document.getElementById('watchlist-list');
const watchlistAddForm = document.getElementById('watchlist-add-form');
const watchlistTickerInput = document.getElementById('watchlist-ticker');
const watchlistNameInput = document.getElementById('watchlist-name');
const newsStocksListEl = document.getElementById('news-stocks-list');
const newsStocksEmptyEl = document.getElementById('news-stocks-empty');
const newsFeedListEl = document.getElementById('news-feed-list');
const newsFeedEmptyEl = document.getElementById('news-feed-empty');
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
   FEED — WATCHLIST + KOERSEN
   =================================================================== */
const watchlist = new Map(); // id -> {id, ticker, display_name}
let quotesCache = { ts: 0, quotes: [] };

function pct(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const s = (v * 100).toFixed(v > -0.001 && v < 0.001 ? 2 : 1);
  return (v >= 0 ? '+' : '') + s + '%';
}

// De watchlist bestrijkt meerdere beurzen (US, Amsterdam, Warschau, Moskou),
// dus zonder valutateken zou $9 naast €1.555 staan zonder dat je het ziet.
const CURRENCY_SIGN = { USD: '$', EUR: '€', PLN: 'zł ', GBP: '£', CHF: 'CHF ', RUB: '₽ ' };

function priceStr(v, currency) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const sign = CURRENCY_SIGN[currency] || '';
  return sign + v.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function trendClass(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'flat';
  return v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
}

// Beurs afleiden uit het suffix — zelfde regel als quotes.js server-side.
// Puur voor de groepskopjes; de data-routering gebeurt op de server.
function exchangeOf(ticker) {
  const t = ticker.toUpperCase();
  if (t.endsWith('.ME')) return 'Moskou';
  if (t.endsWith('.AS')) return 'Amsterdam';
  if (t.endsWith('.WA') || t.endsWith('.WAR')) return 'Warschau';
  if (t.includes('.')) return 'Europa';
  return 'Verenigde Staten';
}

function cell(row, value, cls) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = value;
  row.appendChild(td);
  return td;
}

function deltaCell(row, value, extraClass) {
  const td = cell(row, pct(value), trendClass(value));
  if (extraClass) td.classList.add(extraClass);
  return td;
}

function renderQuotesStrip() {
  quotesStripEl.innerHTML = '';
  const quotesById = new Map(quotesCache.quotes.map((q) => [q.ticker, q]));
  if (watchlist.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted-hint';
    empty.textContent = 'Voeg een ticker toe via "Watchlist beheren" hieronder.';
    quotesStripEl.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'quotes-table';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const [label, cls] of [
    ['Naam', ''], ['Koers', ''], ['1d', ''], ['5d', ''],
    ['21d', 'q-hide-sm'], ['63d', 'q-hide-sm'], ['YTD', 'q-hide-sm'],
  ]) {
    const th = document.createElement('th');
    th.textContent = label;
    if (cls) th.className = cls;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  /* Echt groeperen, niet "kop printen zodra de beurs wisselt": de watchlist
     staat op volgorde van toevoegen, dus US-tickers staan verspreid en je kreeg
     twee keer een kop "Verenigde Staten". Binnen een groep blijft de eigen
     volgorde staan. */
  const GROUP_ORDER = ['Verenigde Staten', 'Amsterdam', 'Warschau', 'Moskou', 'Europa'];
  const buckets = new Map();
  for (const item of watchlist.values()) {
    const g = exchangeOf(item.ticker);
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g).push(item);
  }
  const ordered = [
    ...GROUP_ORDER.filter((g) => buckets.has(g)),
    ...[...buckets.keys()].filter((g) => !GROUP_ORDER.includes(g)),
  ];

  const items = [];
  for (const g of ordered) {
    items.push({ group: g });
    for (const item of buckets.get(g)) items.push({ item });
  }

  for (const entry of items) {
    if (entry.group) {
      const gr = document.createElement('tr');
      gr.className = 'q-group';
      const gtd = document.createElement('td');
      gtd.colSpan = 7;
      gtd.textContent = entry.group;
      gr.appendChild(gtd);
      tbody.appendChild(gr);
      continue;
    }
    const item = entry.item;
    const q = quotesById.get(item.ticker);
    const row = document.createElement('tr');
    row.dataset.ticker = item.ticker;

    // naam
    const nameTd = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'q-name';
    const sym = document.createElement('span');
    sym.className = 'q-sym';
    sym.textContent = item.ticker;
    wrap.appendChild(sym);
    const co = document.createElement('span');
    co.className = 'q-co';
    co.textContent = item.display_name || '';
    wrap.appendChild(co);
    nameTd.appendChild(wrap);
    row.appendChild(nameTd);

    if (q && q.error && q.price === null) {
      // geen enkele koers bekend: toon de reden, verder niets verzinnen
      const td = document.createElement('td');
      td.colSpan = 6;
      td.className = 'q-err';
      td.textContent = q.error;
      row.appendChild(td);
    } else if (q && q.price !== null && q.price !== undefined) {
      const p = cell(row, priceStr(q.price, q.currency), 'q-price');
      // laatst bekende koers bij een storing: markeren i.p.v. stilzwijgend tonen
      if (q.error) p.title = `Laatst bekend — ${q.error}`;
      deltaCell(row, q.deltas.d1, 'q-d1');
      deltaCell(row, q.deltas.d5);
      deltaCell(row, q.deltas.d21, 'q-hide-sm');
      deltaCell(row, q.deltas.d63, 'q-hide-sm');
      deltaCell(row, q.deltas.ytd, 'q-hide-sm');
    } else {
      const td = document.createElement('td');
      td.colSpan = 6;
      td.className = 'q-load';
      td.textContent = 'laden…';
      row.appendChild(td);
    }

    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  quotesStripEl.appendChild(table);
}

function renderWatchlistManager() {
  watchlistListEl.innerHTML = '';
  if (watchlist.size === 0) {
    const p = document.createElement('p');
    p.className = 'muted-hint';
    p.textContent = 'Nog geen tickers.';
    watchlistListEl.appendChild(p);
    return;
  }
  for (const item of watchlist.values()) {
    const row = document.createElement('div');
    row.className = 'watchlist-row';
    const label = document.createElement('span');
    label.className = 'watchlist-label';
    label.textContent = item.display_name
      ? `${item.ticker} — ${item.display_name}`
      : item.ticker;
    row.appendChild(label);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn';
    del.textContent = 'Verwijder';
    del.addEventListener('click', () => removeWatchlistItem(item.id));
    row.appendChild(del);
    watchlistListEl.appendChild(row);
  }
}

async function loadWatchlist() {
  try {
    const res = await fetch('/api/watchlist');
    const rows = await res.json();
    watchlist.clear();
    for (const r of rows) watchlist.set(r.id, r);
    renderWatchlistManager();
    renderQuotesStrip();
  } catch {
    /* stille fallback */
  }
}

async function loadQuotes() {
  try {
    const res = await fetch('/api/quotes');
    const data = await res.json();
    if (res.status === 503) {
      quotesStatusEl.hidden = false;
      quotesStatusEl.textContent = data.error || 'Koersen niet beschikbaar.';
      // toch watchlist synchroniseren wanneer de key ontbreekt.
      if (Array.isArray(data.watchlist)) {
        watchlist.clear();
        for (const r of data.watchlist) watchlist.set(r.id, r);
        renderWatchlistManager();
      }
      quotesCache = { ts: Date.now(), quotes: [] };
      renderQuotesStrip();
      return;
    }
    quotesStatusEl.hidden = true;
    quotesCache = { ts: Date.now(), quotes: data.quotes || [] };
    renderQuotesStrip();
  } catch {
    quotesStatusEl.hidden = false;
    quotesStatusEl.textContent = 'Kon koersen niet ophalen.';
  }
}

watchlistAddForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const ticker = watchlistTickerInput.value.trim();
  const displayName = watchlistNameInput.value.trim();
  if (!ticker) return;
  try {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, display_name: displayName || undefined }),
    });
    if (!res.ok) {
      alert(await apiError(res));
      return;
    }
    watchlistTickerInput.value = '';
    watchlistNameInput.value = '';
    // SSE broadcast + zelf laadt via loadQuotes hieronder.
    await loadQuotes();
  } catch {
    alert('Toevoegen mislukt: geen verbinding.');
  }
});

async function removeWatchlistItem(id) {
  try {
    const res = await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
    if (!res.ok) alert(await apiError(res));
    // SSE brengt watchlist:delete.
  } catch {
    alert('Verwijderen mislukt: geen verbinding.');
  }
}

/* ---------- Nieuws-secties ---------- */
function relTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'net';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m geleden`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}u geleden`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d geleden`;
  return new Date(ms).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

function buildNewsItem(item, withTicker) {
  const el = document.createElement('article');
  el.className = 'news-item';

  const meta = document.createElement('div');
  meta.className = 'news-meta';
  if (item.source) {
    const s = document.createElement('span');
    s.className = 'news-source';
    s.textContent = item.source;
    meta.appendChild(s);
  }
  if (item.published_at) {
    const t = document.createElement('span');
    t.className = 'news-time';
    t.textContent = relTime(item.published_at);
    meta.appendChild(t);
  }
  if (withTicker && item.ticker) {
    const chip = document.createElement('span');
    chip.className = 'news-ticker';
    chip.textContent = item.ticker;
    meta.appendChild(chip);
  }
  el.appendChild(meta);

  const title = document.createElement('h4');
  title.className = 'news-title';
  const a = document.createElement('a');
  a.href = item.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = item.title || '(geen titel)';
  title.appendChild(a);
  el.appendChild(title);

  const summary = item.summary_nl || item.summary;
  if (summary) {
    const p = document.createElement('p');
    p.className = 'news-summary';
    p.textContent = summary;
    el.appendChild(p);
  }
  return el;
}

function renderNewsList(listEl, emptyEl, items, opts = {}) {
  listEl.innerHTML = '';
  const arr = Array.isArray(items) ? items : [];
  if (arr.length === 0) {
    emptyEl.hidden = false;
    if (opts.reason) emptyEl.textContent = opts.reason;
    return;
  }
  emptyEl.hidden = true;
  for (const item of arr) listEl.appendChild(buildNewsItem(item, opts.withTicker));
}

async function loadStockNews() {
  try {
    const res = await fetch('/api/news/stocks');
    if (!res.ok) {
      renderNewsList(newsStocksListEl, newsStocksEmptyEl, [], { reason: 'Nieuws niet beschikbaar.' });
      return;
    }
    const data = await res.json();
    renderNewsList(newsStocksListEl, newsStocksEmptyEl, data.items, { withTicker: true });
  } catch {
    /* stille fallback */
  }
}

async function loadFeedNews() {
  try {
    const res = await fetch('/api/news/feed');
    if (!res.ok) {
      renderNewsList(newsFeedListEl, newsFeedEmptyEl, [], { reason: 'Feed niet bereikbaar.' });
      return;
    }
    const data = await res.json();
    renderNewsList(newsFeedListEl, newsFeedEmptyEl, data.items, {
      reason: data.reason || 'Pipeline nog niet actief.',
    });
  } catch {
    /* stille fallback */
  }
}

/* ===================================================================
   TO-DO'S + LABELS
   =================================================================== */
const labels = new Map();  // id -> {id, name, color}
const filter = new Set();  // actieve label-ids (leeg = geen filter)

function containerFor(todo) {
  return todo.done ? doneTodosEl : openTodosEl;
}

function todoMatchesFilter(todo) {
  if (filter.size === 0) return true;
  return (todo.labels || []).some((l) => filter.has(l.id));
}

function applyFilter() {
  for (const [id, todo] of todos) {
    const el = document.querySelector(`.todo[data-id="${id}"]`);
    if (el) el.classList.toggle('filtered-out', !todoMatchesFilter(todo));
  }
  updateEmptyStates();
}

function updateEmptyStates() {
  let openCount = 0;
  let doneCount = 0;
  for (const t of todos.values()) {
    if (!todoMatchesFilter(t)) continue;
    if (t.done) doneCount += 1;
    else openCount += 1;
  }
  todoEmptyEl.hidden = openCount > 0;
  doneCountEl.textContent = String(doneCount);
  doneSectionEl.hidden = doneCount === 0;
}

/* ---------- Chip-helper ---------- */
function makeLabelChip(label) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.dataset.labelId = label.id;
  chip.style.setProperty('--chip-color', label.color);
  const dot = document.createElement('span');
  dot.className = 'chip-dot';
  chip.appendChild(dot);
  const name = document.createElement('span');
  name.textContent = label.name;
  chip.appendChild(name);
  return chip;
}

/* ---------- Filter-chips ---------- */
function renderFilterChips() {
  filterChipsEl.innerHTML = '';
  for (const label of labels.values()) {
    const chip = makeLabelChip(label);
    chip.classList.add('clickable');
    chip.classList.toggle('active', filter.has(label.id));
    chip.addEventListener('click', () => {
      if (filter.has(label.id)) filter.delete(label.id);
      else filter.add(label.id);
      renderFilterChips();
      applyFilter();
    });
    filterChipsEl.appendChild(chip);
  }
  filterClearBtn.hidden = filter.size === 0;
}

filterClearBtn.addEventListener('click', () => {
  filter.clear();
  renderFilterChips();
  applyFilter();
});

/* ---------- Labels beheren ---------- */
function renderLabelManager() {
  labelMgmtListEl.innerHTML = '';
  if (labels.size === 0) {
    const p = document.createElement('p');
    p.className = 'muted-hint';
    p.textContent = 'Nog geen labels — voeg er hieronder een toe.';
    labelMgmtListEl.appendChild(p);
    return;
  }
  for (const label of labels.values()) {
    const row = document.createElement('div');
    row.className = 'label-mgmt-row';
    row.appendChild(makeLabelChip(label));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn';
    del.textContent = 'Verwijder';
    del.addEventListener('click', () => deleteLabel(label.id));
    row.appendChild(del);
    labelMgmtListEl.appendChild(row);
  }
}

newLabelForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = newLabelName.value.trim();
  const color = newLabelColor.value || '#3b82f6';
  if (!name) return;
  createLabel(name, color);
});

async function loadLabels() {
  try {
    const res = await fetch('/api/labels');
    const rows = await res.json();
    labels.clear();
    for (const l of rows) labels.set(l.id, l);
    renderFilterChips();
    renderLabelManager();
  } catch {
    // stille fallback — pagina blijft werken zonder labels
  }
}

async function createLabel(name, color) {
  try {
    const res = await fetch('/api/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color }),
    });
    if (!res.ok) {
      alert(await apiError(res));
      return;
    }
    newLabelName.value = '';
    // SSE label:new zorgt voor de re-render bij alle clients.
  } catch {
    alert('Label toevoegen mislukt: geen verbinding.');
  }
}

async function deleteLabel(id) {
  try {
    const res = await fetch(`/api/labels/${id}`, { method: 'DELETE' });
    if (!res.ok) alert(await apiError(res));
    // SSE label:delete + todo:edit voor de betroffen todos.
  } catch {
    alert('Label verwijderen mislukt: geen verbinding.');
  }
}

/* ---------- Todo-rendering ---------- */
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

  if (todo.labels && todo.labels.length) {
    const chipRow = document.createElement('div');
    chipRow.className = 'todo-chips';
    for (const l of todo.labels) chipRow.appendChild(makeLabelChip(l));
    body.appendChild(chipRow);
  }

  if (todo.edited_at) {
    const meta = document.createElement('div');
    meta.className = 'todo-meta';
    const edited = document.createElement('span');
    edited.className = 'edited-label';
    edited.textContent = '(bewerkt)';
    meta.appendChild(edited);
    body.appendChild(meta);
  }
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

  const selected = new Set((todo.labels || []).map((l) => l.id));
  const labelSel = document.createElement('div');
  labelSel.className = 'label-selector';
  if (labels.size === 0) {
    const hint = document.createElement('span');
    hint.className = 'muted-hint';
    hint.textContent = 'Geen labels — maak er een via de filterbalk.';
    labelSel.appendChild(hint);
  } else {
    for (const label of labels.values()) {
      const chip = makeLabelChip(label);
      chip.classList.add('clickable');
      chip.classList.toggle('selected', selected.has(label.id));
      chip.addEventListener('click', () => {
        if (selected.has(label.id)) selected.delete(label.id);
        else selected.add(label.id);
        chip.classList.toggle('selected', selected.has(label.id));
      });
      labelSel.appendChild(chip);
    }
  }
  el.appendChild(labelSel);

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  actions.appendChild(
    makeBtn('Opslaan', () => saveTodoEdit(todo.id, ta.value, [...selected])),
  );
  actions.appendChild(
    makeBtn('Annuleer', () => renderTodoView(el, todos.get(todo.id) || todo)),
  );
  el.appendChild(actions);

  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

/* ---------- Todo state-updates ---------- */
function addTodo(todo) {
  todos.set(todo.id, todo);
  const existing = document.querySelector(`.todo[data-id="${todo.id}"]`);
  if (existing) existing.remove();
  containerFor(todo).prepend(buildTodoEl(todo));
  applyFilter();
}

function updateTodo(todo) {
  const prev = todos.get(todo.id);
  todos.set(todo.id, todo);
  const existing = document.querySelector(`.todo[data-id="${todo.id}"]`);
  if (existing && existing.classList.contains('editing')) return; // niet clobberen
  if (existing) {
    // Done-state gewisseld → verplaatsen; anders in-place her-renderen zodat
    // de positie in de lijst behouden blijft.
    if (prev && !!prev.done !== !!todo.done) {
      existing.remove();
      containerFor(todo).prepend(buildTodoEl(todo));
    } else {
      renderTodoView(existing, todo);
    }
  } else {
    containerFor(todo).prepend(buildTodoEl(todo));
  }
  applyFilter();
}

function removeTodo(id) {
  todos.delete(id);
  const el = document.querySelector(`.todo[data-id="${id}"]`);
  if (el) el.remove();
  updateEmptyStates();
}

async function loadTodos() {
  const res = await fetch('/api/todos');
  const rows = await res.json(); // nieuwste-eerst
  todos.clear();
  openTodosEl.innerHTML = '';
  doneTodosEl.innerHTML = '';
  for (const t of rows) {
    todos.set(t.id, t);
    containerFor(t).appendChild(buildTodoEl(t));
  }
  applyFilter();
}

/* ---------- Quick-add vanuit de to-do view ---------- */
todoAddForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = todoAddInput.value.trim();
  if (!text) return;
  const ok = await createTodo(text);
  if (ok) todoAddInput.value = '';
});

async function createTodo(text, labelIds) {
  const value = String(text || '').trim();
  if (!value) return false;
  const body = { text: value };
  if (Array.isArray(labelIds) && labelIds.length) body.labels = labelIds;
  try {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

async function saveTodoEdit(id, raw, labelIds) {
  const text = raw.trim();
  if (!text) return;
  const body = { text };
  if (Array.isArray(labelIds)) body.labels = labelIds;
  try {
    const res = await fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      alert(await apiError(res));
      return;
    }
    const updated = await res.json();
    todos.set(updated.id, updated);
    const el = document.querySelector(`.todo[data-id="${updated.id}"]`);
    if (el) renderTodoView(el, updated);
    applyFilter();
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
  source.addEventListener('label:new', (e) => {
    const l = JSON.parse(e.data);
    labels.set(l.id, l);
    renderFilterChips();
    renderLabelManager();
  });
  source.addEventListener('label:delete', (e) => {
    const { id } = JSON.parse(e.data);
    labels.delete(id);
    filter.delete(id);
    renderFilterChips();
    renderLabelManager();
  });
  // Server ververst koersen op een timer; dan meteen de strip bijwerken.
  source.addEventListener('quotes:update', () => { loadQuotes(); });

  source.addEventListener('watchlist:new', (e) => {
    const item = JSON.parse(e.data);
    watchlist.set(item.id, item);
    renderWatchlistManager();
    renderQuotesStrip();
    loadQuotes();
    loadStockNews();
  });
  source.addEventListener('watchlist:delete', (e) => {
    const { id } = JSON.parse(e.data);
    watchlist.delete(id);
    renderWatchlistManager();
    renderQuotesStrip();
    loadStockNews();
  });
}

/* ---------- Init ---------- */
loadMessages();
loadLabels();
loadTodos();
loadWatchlist().then(loadQuotes);
loadStockNews();
loadFeedNews();
connectSSE();
setView('feed'); // default: dashboard/feed

// Koersen elke 60s (matcht server-cache).
setInterval(loadQuotes, 60 * 1000);
// Nieuws elke 15 min (matcht server-cache 15 min).
setInterval(loadStockNews, 15 * 60 * 1000);
setInterval(loadFeedNews, 15 * 60 * 1000);

/* ---------- PWA service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => console.warn('SW-registratie mislukt:', err));
  });
}
