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
const themeToggle = document.getElementById('theme-toggle');
const themeToggleMobile = document.getElementById('theme-toggle-mobile');
const marketStatusDot = document.getElementById('market-status-dot');
const marketStatusText = document.getElementById('market-status-text');
const quotesUpdatedText = document.getElementById('quotes-updated-text');
const kpiPortfolioValueEl = document.getElementById('kpi-portfolio-value');
const kpiSavingsValueEl = document.getElementById('kpi-savings-value');
const kpiSavingsSubEl = document.getElementById('kpi-savings-sub');
const kpiMortgageValueEl = document.getElementById('kpi-mortgage-value');
const kpiMortgageSubEl = document.getElementById('kpi-mortgage-sub');
const kpiSavingsSparkEl = document.getElementById('kpi-savings-spark');
const kpiMortgageSparkEl = document.getElementById('kpi-mortgage-spark');
const kpiOilValueEl = document.getElementById('kpi-oil-value');
const kpiOilSubEl = document.getElementById('kpi-oil-sub');
const kpiOilSparkEl = document.getElementById('kpi-oil-spark');
const kpiCryptoValueEl = document.getElementById('kpi-crypto-value');
const kpiCryptoSubEl = document.getElementById('kpi-crypto-sub');
const kpiCryptoSparkEl = document.getElementById('kpi-crypto-spark');
const homeStocksExcerptEl = document.getElementById('home-stocks-excerpt');
const homeMoversEl = document.getElementById('home-movers');
const homeNewsStocksEl = document.getElementById('home-news-stocks');
const homeNewsFeedEl = document.getElementById('home-news-feed');
const homeTodosListEl = document.getElementById('home-todos-list');
const homeTodosEmptyEl = document.getElementById('home-todos-empty');
const homeTodoAddForm = document.getElementById('home-todo-add-form');
const homeTodoAddInput = document.getElementById('home-todo-add-input');

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

// Compacte vierkante knop met alleen een symbool (i.p.v. tekstlabel) —
// scheelt breedte in rijen die al veel acties naast elkaar hebben (to-do's
// met schuifknoppen + labels). aria-label/title houden 'm toegankelijk.
function makeIconBtn(symbol, ariaLabel, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn icon-btn-square';
  b.textContent = symbol;
  b.setAttribute('aria-label', ariaLabel);
  b.title = ariaLabel;
  b.addEventListener('click', onClick);
  return b;
}

/* ---------- View-routing (sidebar / bottom-nav / meer-overflow) ---------- */
// Elke pagina is een eigen <section class="view" id="<naam>-view">. Precies
// één krijgt .view-active; alle nav-knoppen delen dezelfde class + attribuut,
// ongeacht of ze in de sidebar, de mobile-nav of het meer-overzicht staan.
function setView(view) {
  document.body.dataset.view = view;
  for (const el of document.querySelectorAll('.view')) {
    el.classList.toggle('view-active', el.id === `${view}-view`);
  }
  for (const btn of navButtons) {
    btn.classList.toggle('active', btn.dataset.viewTarget === view);
  }
  if (view === 'chat') input.focus();
}

// Breder dan alleen .nav-btn: ook de kleine "Bekijk alles →"-linkjes in de
// Home-widgets hebben data-view-target, maar tellen niet mee als persistente
// tab (die "active"-status blijft beperkt tot .nav-btn, zie setView hierboven).
for (const el of document.querySelectorAll('[data-view-target]')) {
  el.addEventListener('click', () => setView(el.dataset.viewTarget));
}

/* ---------- Dark mode ---------- */
const THEME_KEY = 'janapp-theme';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* privé-modus o.i.d. */ }
  const label = theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode';
  for (const btn of [themeToggle, themeToggleMobile]) if (btn) btn.textContent = label;
}

function currentTheme() {
  const stored = document.documentElement.dataset.theme;
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function toggleTheme() {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

applyTheme(currentTheme()); // knop-label meteen kloppend zetten
themeToggle.addEventListener('click', toggleTheme);
themeToggleMobile.addEventListener('click', toggleTheme);

/* ---------- Markt-status (VS-beurstijden) + "data bijgewerkt" ---------- */
// De watchlist bestrijkt meerdere beurzen; één harde open/dicht-indicator kan
// dus niet voor allemaal kloppen. We tonen de Amerikaanse markt (grootste deel
// van de meeste watchlists) en zijn daar expliciet over via het label.
function usMarketOpenNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekday = get('weekday');
  const minutes = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
  const isWeekday = weekday !== 'Sat' && weekday !== 'Sun';
  return isWeekday && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

function updateMarketStatus() {
  const open = usMarketOpenNow();
  marketStatusDot.classList.toggle('open', open);
  marketStatusText.textContent = open ? 'Markt open (VS)' : 'Markt dicht (VS)';

  if (quotesCache.ts) {
    const mins = Math.max(0, Math.round((Date.now() - quotesCache.ts) / 60000));
    quotesUpdatedText.textContent = mins < 1 ? 'Data bijgewerkt: net' : `Data bijgewerkt: ${mins}m geleden`;
  } else {
    quotesUpdatedText.textContent = '';
  }
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
let quotesCache = { ts: 0, quotes: [], extras: {} };

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

// Compacte sparkline als inline-SVG. Kleur volgt de trend (groen op/rood neer),
// zodat hij aansluit bij de percentages ernaast.
const SVG_NS = 'http://www.w3.org/2000/svg';
// Geen expliciete width/height-attributen: CSS (.spark { width:100% }) bepaalt
// de daadwerkelijke weergavebreedte, zodat de lijn de kolom altijd volledig
// vult — ongeacht hoe breed die kolom precies wordt gerenderd (was eerst een
// vaste px-breedte, die bij een bredere kolom een kale rand overliet).
function sparklineSvg(closes) {
  const w = 200; // interne coördinaten-breedte (viewBox), niet de weergave
  const h = 22;
  const pad = 2;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none'); // vult de kolombreedte exact
  svg.classList.add('spark');
  if (!Array.isArray(closes) || closes.length < 3) return svg;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const pts = closes
    .map((c, i) => {
      const x = pad + (i * (w - 2 * pad)) / (closes.length - 1);
      const y = h - pad - ((c - min) / range) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', pts);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke-width', '1.4');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('stroke-linecap', 'round');
  // Kleur volgt de eigen periode: eind hoger dan begin = groen.
  const up = closes[closes.length - 1] >= closes[0];
  line.setAttribute('stroke', up ? '#16a34a' : '#dc2626');
  svg.appendChild(line);
  return svg;
}

// Kop van de koerstabel — gedeeld tussen de volledige Aandelen-tabel en het
// (ongecapte) Home-excerpt, zodat beide exact dezelfde kolommen tonen.
function buildQuotesThead() {
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  // Handelsdagen, maar leesbare koppen: 5 handelsdagen ≈ 1 week, 21 ≈ 1 maand,
  // 63 ≈ 3 maanden. Zonder weekend-vertekening, wél begrijpelijk.
  for (const [label, cls] of [
    ['Naam', ''], ['Koers', ''], ['1d', ''], ['1w', ''],
    ['1m', 'q-hide-sm'], ['3m', 'q-hide-sm'], ['YTD', 'q-hide-sm'],
    ['3 mnd', 'q-hide-sm q-spark'], // periode van de sparkline
  ]) {
    const th = document.createElement('th');
    th.textContent = label;
    if (cls) th.className = cls;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  return thead;
}

// Eén rij van de koerstabel — alle kolommen (koers, 1d/1w/1m/3m/YTD,
// sparkline). Gedeeld tussen de volledige Aandelen-tabel en het Home-excerpt.
function buildQuoteRow(item, q) {
  const row = document.createElement('tr');
  row.dataset.ticker = item.ticker;

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
    td.colSpan = 7;
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
    // sparkline (30 handelsdagen), kleur volgt de 1m-trend
    const sp = document.createElement('td');
    sp.className = 'q-hide-sm q-spark';
    sp.appendChild(sparklineSvg(q.spark));
    row.appendChild(sp);
  } else {
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'q-load';
    td.textContent = 'laden…';
    row.appendChild(td);
  }
  return row;
}

// Portfolio-KPI-placeholder: er zijn nog geen echte holdings (fase 9, apart
// aandeel+aantal+aankoopprijs) — tot die er zijn, op verzoek een indicatie
// o.b.v. het ongewogen gemiddelde van de 1w-delta (d5) over de hele
// watchlist. Zodra fase 9 er is, vervangt een echte P&L-berekening dit.
function updatePortfolioPlaceholder() {
  if (!kpiPortfolioValueEl) return;
  const vals = quotesCache.quotes
    .map((q) => q.deltas && q.deltas.d5)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!vals.length) {
    kpiPortfolioValueEl.textContent = '–';
    kpiPortfolioValueEl.className = 'kpi-value';
    return;
  }
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  kpiPortfolioValueEl.textContent = pct(avg);
  kpiPortfolioValueEl.className = 'kpi-value ' + trendClass(avg);
}

// Oil & Gas (WTI-olie) en Crypto (Bitcoin) — komen niet uit de watchlist maar
// als losse "extra's" uit dezelfde Twelve Data-infrastructuur (zie quotes.js),
// met échte dagcandles, dus meteen een volwaardige sparkline i.p.v. de
// aanname-fallback die de rentes gebruiken (die accumuleren maar 1x/dag).
function renderExtraKpi(valueEl, subEl, sparkEl, q, label) {
  if (!valueEl) return;
  if (!q || q.price === null || q.price === undefined) {
    valueEl.textContent = '–';
    valueEl.className = 'kpi-value';
    if (subEl) subEl.textContent = q && q.error ? 'Niet beschikbaar' : 'Laden…';
    if (sparkEl) sparkEl.innerHTML = '';
    return;
  }
  const d1 = q.deltas && q.deltas.d1;
  valueEl.textContent = priceStr(q.price, q.currency);
  valueEl.className = 'kpi-value ' + trendClass(d1);
  if (subEl) subEl.textContent = `${label} · ${pct(d1)}`;
  if (sparkEl) {
    sparkEl.innerHTML = '';
    if (Array.isArray(q.spark) && q.spark.length >= 3) sparkEl.appendChild(sparklineSvg(q.spark));
  }
}

function renderExtras() {
  const extras = quotesCache.extras || {};
  renderExtraKpi(kpiOilValueEl, kpiOilSubEl, kpiOilSparkEl, extras.oil, 'WTI Crude');
  renderExtraKpi(kpiCryptoValueEl, kpiCryptoSubEl, kpiCryptoSparkEl, extras.crypto, 'Bitcoin');
}

function renderQuotesStrip() {
  // Home-excerpt (aandelen + movers) leest dezelfde watchlist/quotesCache,
  // dus hier centraal aanroepen dekt alle call-sites in één keer.
  renderHomeStocksAndMovers();
  updatePortfolioPlaceholder();
  renderExtras();

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
  table.appendChild(buildQuotesThead());

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
      gtd.colSpan = 8;
      gtd.textContent = entry.group;
      gr.appendChild(gtd);
      tbody.appendChild(gr);
      continue;
    }
    tbody.appendChild(buildQuoteRow(entry.item, quotesById.get(entry.item.ticker)));
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
  // Zelfde groepering als de koerstabel, zodat verschuiven binnen de eigen beurs
  // gebeurt (cross-beurs verschuiven zou in de gegroepeerde tabel niets doen).
  const items = [...watchlist.values()];
  const GROUP_ORDER = ['Verenigde Staten', 'Amsterdam', 'Warschau', 'Moskou', 'Europa'];
  const buckets = new Map();
  for (const item of items) {
    const g = exchangeOf(item.ticker);
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g).push(item);
  }
  const ordered = [
    ...GROUP_ORDER.filter((g) => buckets.has(g)),
    ...[...buckets.keys()].filter((g) => !GROUP_ORDER.includes(g)),
  ];

  for (const g of ordered) {
    const groupItems = buckets.get(g);
    const head = document.createElement('div');
    head.className = 'wl-group';
    head.textContent = g;
    watchlistListEl.appendChild(head);

    groupItems.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'watchlist-row';

      const moves = document.createElement('span');
      moves.className = 'wl-moves';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'wl-move';
      up.textContent = '▲';
      up.title = 'Omhoog';
      up.disabled = i === 0;
      up.addEventListener('click', () => moveWithinGroup(g, item.id, -1));
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'wl-move';
      down.textContent = '▼';
      down.title = 'Omlaag';
      down.disabled = i === groupItems.length - 1;
      down.addEventListener('click', () => moveWithinGroup(g, item.id, +1));
      moves.appendChild(up);
      moves.appendChild(down);
      row.appendChild(moves);

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
    });
  }
}

// Verschuif een ticker één plek binnen zijn beursgroep en persisteer de nieuwe
// volgorde. Optimistisch: lokaal meteen bijwerken, dan naar de server.
async function moveWithinGroup(group, id, dir) {
  const items = [...watchlist.values()];
  const groupIds = items.filter((it) => exchangeOf(it.ticker) === group).map((it) => it.id);
  const gi = groupIds.indexOf(id);
  const target = gi + dir;
  if (gi < 0 || target < 0 || target >= groupIds.length) return;

  // swap in de volledige lijst op de posities van beide groepsleden
  const flat = items.map((it) => it.id);
  const aPos = flat.indexOf(groupIds[gi]);
  const bPos = flat.indexOf(groupIds[target]);
  [flat[aPos], flat[bPos]] = [flat[bPos], flat[aPos]];

  // lokale Map in nieuwe volgorde herbouwen (Map bewaart invoegvolgorde)
  const byId = new Map(watchlist);
  watchlist.clear();
  for (const fid of flat) watchlist.set(fid, byId.get(fid));
  renderWatchlistManager();
  renderQuotesStrip();

  try {
    await fetch('/api/watchlist/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: flat }),
    });
  } catch {
    loadWatchlist(); // bij een fout terug naar de serverwaarheid
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
      quotesCache = { ts: Date.now(), quotes: [], extras: {} };
      renderQuotesStrip();
      return;
    }
    quotesStatusEl.hidden = true;
    quotesCache = { ts: Date.now(), quotes: data.quotes || [], extras: data.extras || {} };
    renderQuotesStrip();
  } catch {
    quotesStatusEl.hidden = false;
    quotesStatusEl.textContent = 'Kon koersen niet ophalen.';
  }
  updateMarketStatus();
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

// Meta-regel: bron · tijd, en rechts de aandeel-chips (max 2, dan +N).
function buildNewsMeta(item, withTicker) {
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
  const tickers = withTicker ? (item.tickers || (item.ticker ? [item.ticker] : [])) : [];
  if (tickers.length) {
    const wrap = document.createElement('span');
    wrap.className = 'news-tickers';
    tickers.slice(0, 2).forEach((tk) => {
      const chip = document.createElement('span');
      chip.className = 'news-ticker';
      chip.textContent = tk;
      wrap.appendChild(chip);
    });
    if (tickers.length > 2) {
      const more = document.createElement('span');
      more.className = 'news-ticker news-ticker-more';
      more.textContent = `+${tickers.length - 2}`;
      wrap.appendChild(more);
    }
    meta.appendChild(wrap);
  }
  return meta;
}

// Headline: volledige kaart met zichtbare (ingekorte) samenvatting.
function buildHeadline(item, withTicker) {
  const el = document.createElement('article');
  el.className = 'news-item headline';
  el.appendChild(buildNewsMeta(item, withTicker));

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

// Compacte regel: alleen de titel; klik vouwt op de pagina zelf uit naar
// samenvatting + "Lees verder" naar het bronartikel.
function buildNewsRow(item, withTicker) {
  const el = document.createElement('div');
  el.className = 'news-row';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'news-row-head';
  const caret = document.createElement('span');
  caret.className = 'news-caret';
  caret.textContent = '▸';
  const ttl = document.createElement('span');
  ttl.className = 'news-row-title';
  ttl.textContent = item.title || '(geen titel)';
  head.appendChild(caret);
  head.appendChild(ttl);

  const fold = document.createElement('div');
  fold.className = 'news-fold';
  fold.appendChild(buildNewsMeta(item, withTicker));
  const summary = item.summary_nl || item.summary;
  if (summary) {
    const p = document.createElement('p');
    p.className = 'news-summary';
    p.textContent = summary;
    fold.appendChild(p);
  }
  const more = document.createElement('a');
  more.className = 'news-more';
  more.href = item.url;
  more.target = '_blank';
  more.rel = 'noopener noreferrer';
  more.textContent = 'Lees verder →';
  fold.appendChild(more);

  head.addEventListener('click', () => el.classList.toggle('open'));
  el.appendChild(head);
  el.appendChild(fold);
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

  const headlineCount = opts.headlines ?? 3;
  const heads = arr.slice(0, headlineCount);
  const rest = arr.slice(headlineCount);

  for (const item of heads) listEl.appendChild(buildHeadline(item, opts.withTicker));

  if (rest.length) {
    const rows = document.createElement('div');
    rows.className = 'news-rows';
    for (const item of rest) rows.appendChild(buildNewsRow(item, opts.withTicker));
    listEl.appendChild(rows);
  }
}

// Laatst opgehaalde items, zodat de Home-excerpts (top 3) dezelfde data
// hergebruiken zonder een tweede fetch te doen.
let lastStockNews = [];
let lastFeedNews = [];

async function loadStockNews() {
  try {
    const res = await fetch('/api/news/stocks');
    if (!res.ok) {
      renderNewsList(newsStocksListEl, newsStocksEmptyEl, [], { reason: 'Nieuws niet beschikbaar.' });
      lastStockNews = [];
      renderHomeNews();
      return;
    }
    const data = await res.json();
    lastStockNews = Array.isArray(data.items) ? data.items : [];
    renderNewsList(newsStocksListEl, newsStocksEmptyEl, data.items, { withTicker: true });
    renderHomeNews();
  } catch {
    /* stille fallback */
  }
}

async function loadFeedNews() {
  try {
    const res = await fetch('/api/news/feed');
    if (!res.ok) {
      renderNewsList(newsFeedListEl, newsFeedEmptyEl, [], { reason: 'Feed niet bereikbaar.' });
      lastFeedNews = [];
      renderHomeNews();
      return;
    }
    const data = await res.json();
    lastFeedNews = Array.isArray(data.items) ? data.items : [];
    renderNewsList(newsFeedListEl, newsFeedEmptyEl, data.items, {
      reason: data.reason || 'Pipeline nog niet actief.',
    });
    renderHomeNews();
  } catch {
    /* stille fallback */
  }
}

/* ===================================================================
   HOME-DASHBOARD (excerpts van bovenstaande + to-do's)
   =================================================================== */
// Alleen nieuws wordt afgekapt (headlines + "Meer nieuws"-link) — aandelen
// en to-do's tonen hun volledige lijst, die is doorgaans kort genoeg.
const HOME_NEWS_COUNT = 3;

// Compacte rij: ticker + naam + koers + 1d-delta. Geen groepskopjes/sparkline
// — dat is precies waarom dit een "excerpt" is, de volledige tabel staat op
// de Aandelen-pagina.
function renderHomeStocksAndMovers() {
  if (!homeStocksExcerptEl) return;
  const quotesById = new Map(quotesCache.quotes.map((q) => [q.ticker, q]));
  const items = [...watchlist.values()];

  // Volledige tabel, alle kolommen — net als de Aandelen-pagina, alleen
  // zonder beursgroepering. Niet capped: de hele watchlist past hier prima.
  homeStocksExcerptEl.innerHTML = '';
  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted-hint';
    p.textContent = 'Nog geen tickers — voeg er een toe via Watchlist.';
    homeStocksExcerptEl.appendChild(p);
  } else {
    const table = document.createElement('table');
    table.className = 'quotes-table home-quotes-table';
    table.appendChild(buildQuotesThead());
    const tbody = document.createElement('tbody');
    for (const item of items) {
      tbody.appendChild(buildQuoteRow(item, quotesById.get(item.ticker)));
    }
    table.appendChild(tbody);
    homeStocksExcerptEl.appendChild(table);
  }

}

/* ---------- Biggest movers — bewust buiten je watchlist, zie movers.js --------- */
let moversCache = { gainers: [], losers: [], error: null };

function buildMoversList(title, list) {
  const col = document.createElement('div');
  col.className = 'movers-col';
  const h = document.createElement('div');
  h.className = 'movers-col-title';
  h.textContent = title;
  col.appendChild(h);
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'movers-row muted-hint';
    empty.textContent = 'Geen gevonden';
    col.appendChild(empty);
  }
  for (const s of list) {
    const row = document.createElement('div');
    row.className = 'movers-row';
    const wrap = document.createElement('span');
    wrap.className = 'q-name';
    const sym = document.createElement('span');
    sym.className = 'q-sym';
    sym.textContent = s.ticker;
    wrap.appendChild(sym);
    const co = document.createElement('span');
    co.className = 'q-co';
    co.textContent = s.name || '';
    wrap.appendChild(co);
    row.appendChild(wrap);
    const d = document.createElement('span');
    d.className = trendClass(s.changePct);
    d.textContent = pct(s.changePct / 100);
    row.appendChild(d);
    col.appendChild(row);
  }
  return col;
}

function renderMovers() {
  if (!homeMoversEl) return;
  homeMoversEl.innerHTML = '';
  if (moversCache.gainers.length === 0 && moversCache.losers.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted-hint';
    p.textContent = moversCache.error ? 'Movers niet beschikbaar.' : 'Movers laden…';
    homeMoversEl.appendChild(p);
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'movers-grid';
  grid.appendChild(buildMoversList('Grootste stijgers', moversCache.gainers));
  grid.appendChild(buildMoversList('Grootste dalers', moversCache.losers));
  homeMoversEl.appendChild(grid);
}

// Bewust buiten je watchlist (die zie je al in "Mijn aandelen" hierboven) —
// server filtert al op marktkapitalisatie + sluit je eigen tickers uit.
async function loadMovers() {
  try {
    const res = await fetch('/api/movers');
    const data = await res.json();
    moversCache = { gainers: data.gainers || [], losers: data.losers || [], error: data.error };
  } catch {
    moversCache = { gainers: [], losers: [], error: 'geen verbinding' };
  }
  renderMovers();
}

function renderHomeNews() {
  if (!homeNewsStocksEl) return;
  homeNewsStocksEl.innerHTML = '';
  if (lastStockNews.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted-hint';
    p.textContent = 'Nog geen nieuws voor je watchlist.';
    homeNewsStocksEl.appendChild(p);
  } else {
    for (const item of lastStockNews.slice(0, HOME_NEWS_COUNT)) {
      homeNewsStocksEl.appendChild(buildHeadline(item, true));
    }
  }

  homeNewsFeedEl.innerHTML = '';
  if (lastFeedNews.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted-hint';
    p.textContent = 'Pipeline nog niet actief.';
    homeNewsFeedEl.appendChild(p);
  } else {
    for (const item of lastFeedNews.slice(0, HOME_NEWS_COUNT)) {
      homeNewsFeedEl.appendChild(buildHeadline(item, false));
    }
  }
}

// Simpele open-lijst (geen Vandaag/Later — vervaldatums zijn bewust geskipt).
// Sparrente/hypotheekrente-KPI's (best-effort scraper, zie rates.js op de
// server — ververst 1x per dag, dus geen aparte poll-interval nodig hier).
// Trendlijn is indicatief: hij bouwt zich op vanaf de eerste dag dat deze
// app draait (geen gratis historische-rente-API bestaat) — pas na enkele
// weken tot maanden wordt hij echt betekenisvol. sparklineSvg tekent sowieso
// pas vanaf 3 datapunten, dus in het begin blijft de kaart bewust leeg.
function buildRateArrow(cls, symbol, title) {
  const arrow = document.createElement('span');
  arrow.className = 'rate-trend-arrow ' + cls;
  arrow.textContent = symbol;
  arrow.title = title;
  return arrow;
}

function renderRateSpark(el, spark) {
  el.innerHTML = '';
  if (!Array.isArray(spark) || spark.length === 0) return;
  if (spark.length >= 3) {
    el.appendChild(sparklineSvg(spark));
    return;
  }
  if (spark.length === 2) {
    // Nog geen 3 punten voor een lijngrafiek (bouwt zich dagelijks op) —
    // toon in de tussentijd een pijltje voor de laatste beweging t.o.v. de
    // vorige meting, zodat er meteen íéts van trend zichtbaar is.
    const delta = spark[1] - spark[0];
    el.appendChild(buildRateArrow(
      delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
      delta > 0 ? '▲' : delta < 0 ? '▼' : '–',
      delta > 0 ? 'Gestegen t.o.v. de vorige meting'
        : delta < 0 ? 'Gedaald t.o.v. de vorige meting'
          : 'Ongewijzigd t.o.v. de vorige meting',
    ));
    return;
  }
  // Nog maar 1 meting (nog geen enkele vergelijking mogelijk): op verzoek
  // een voorlopige aanname van een stijgende trend, tot er echte data is —
  // corrigeert zichzelf zodra er een 2e meting binnenkomt.
  el.appendChild(buildRateArrow('up', '▲', 'Aanname (nog geen historische data): stijgende trend'));
}

async function loadRates() {
  try {
    const res = await fetch('/api/rates');
    const data = await res.json();
    if (data.savings) {
      kpiSavingsValueEl.textContent = data.savings.rate.toLocaleString('nl-NL', { minimumFractionDigits: 2 }) + '%';
      kpiSavingsSubEl.textContent = data.savings.name;
      renderRateSpark(kpiSavingsSparkEl, data.savings.spark);
    } else {
      kpiSavingsValueEl.textContent = '–';
      kpiSavingsSubEl.textContent = data.error ? 'Niet beschikbaar' : 'Laden…';
    }
    if (data.mortgage) {
      kpiMortgageValueEl.textContent = data.mortgage.rate.toLocaleString('nl-NL', { minimumFractionDigits: 2 }) + '%';
      kpiMortgageSubEl.textContent = `${data.mortgage.years}j vast NHG · ${data.mortgage.bank}`;
      renderRateSpark(kpiMortgageSparkEl, data.mortgage.spark);
    } else {
      kpiMortgageValueEl.textContent = '–';
      kpiMortgageSubEl.textContent = data.error ? 'Niet beschikbaar' : 'Laden…';
    }
  } catch {
    kpiSavingsSubEl.textContent = 'Niet beschikbaar';
    kpiMortgageSubEl.textContent = 'Niet beschikbaar';
  }
}

homeTodoAddForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = homeTodoAddInput.value.trim();
  if (!text) return;
  const ok = await createTodo(text);
  if (ok) homeTodoAddInput.value = '';
});

/* ===================================================================
   TO-DO'S + LABELS
   =================================================================== */
const labels = new Map();  // id -> {id, name, color}
const filter = new Set();  // actieve label-ids (leeg = geen filter)

// Een todo staat als los DOM-element in één of meer containers: open items
// staan zowel op de volledige to-do-pagina als (ongefilterd) in het
// Home-widget, afgeronde items alleen op de volledige pagina (Home toont
// nooit afgeronde items).
function containersFor(todo) {
  return todo.done ? [doneTodosEl] : [openTodosEl, homeTodosListEl];
}

// Alle DOM-instanties van één todo (kan er 0, 1 of 2 zijn, zie hierboven).
function allTodoEls(id) {
  return [...document.querySelectorAll(`.todo[data-id="${id}"]`)];
}

function todoMatchesFilter(todo) {
  if (filter.size === 0) return true;
  return (todo.labels || []).some((l) => filter.has(l.id));
}

// Filter geldt alleen voor de volledige to-do-pagina — Home heeft geen
// eigen filterbalk en toont altijd de complete open-lijst, dus expliciet
// scopen op openTodosEl/doneTodosEl i.p.v. alle .todo-elementen globaal.
function applyFilter() {
  for (const el of [...openTodosEl.querySelectorAll('.todo'), ...doneTodosEl.querySelectorAll('.todo')]) {
    const todo = todos.get(Number(el.dataset.id));
    if (todo) el.classList.toggle('filtered-out', !todoMatchesFilter(todo));
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

  // Home telt ALLE open to-do's, filter-onafhankelijk (geen filterbalk daar).
  const totalOpen = [...todos.values()].filter((t) => !t.done).length;
  homeTodosEmptyEl.hidden = totalOpen > 0;
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

// Vaste set van 5 — zelfde waarden als server.js's TODO_COLORS (validatie
// gebeurt server-side; hier alleen voor de kleurkiezer in edit-modus).
const TODO_COLORS = ['#ef4444', '#f97316', '#22c55e', '#3b82f6', '#8b5cf6'];

/* ---------- Todo-rendering ---------- */
function buildTodoEl(todo) {
  const el = document.createElement('div');
  el.className = 'todo';
  el.dataset.id = todo.id;
  renderTodoView(el, todo);
  // Eén keer wiren op het element zelf (niet bij elke re-render, anders
  // stapelen listeners op) — leest de actuele todo-state via de todos-Map
  // op het moment van interactie, niet de todo uit de sluiting hierboven.
  enableTodoDrag(el, () => todos.get(todo.id));
  return el;
}

function renderTodoView(el, todo) {
  el.innerHTML = '';
  el.classList.remove('editing');
  el.classList.toggle('done', !!todo.done);

  // Kaart-kleur (optioneel, via bewerken): custom property + data-attribuut
  // als CSS-haakje, color-mix() in styles.css zorgt voor goed contrast in
  // beide thema's.
  if (todo.color) {
    el.style.setProperty('--todo-color', todo.color);
    el.dataset.color = '1';
  } else {
    el.style.removeProperty('--todo-color');
    delete el.dataset.color;
  }

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

  el.appendChild(body);

  // Geen afvink-knop meer (workflow is: klaar = verwijderen, niet afvinken)
  // en geen ▲▼-knoppen meer (schuiven gaat nu via ingedrukt-houden-en-
  // slepen, zie enableTodoDrag in buildTodoEl) — alleen bewerken/verwijderen
  // blijven over, zo klein en rechts mogelijk zodat de tekst de rest wint.
  const actions = document.createElement('div');
  actions.className = 'item-actions';
  actions.appendChild(makeIconBtn('✎', 'Bewerk', () => renderTodoEdit(el, todo)));
  actions.appendChild(makeIconBtn('✕', 'Verwijder', () => deleteTodo(todo.id)));
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

  // Kaart-kleur: 5 vaste zwatches + "geen kleur", single-select (i.t.t.
  // labels, die meerdere tegelijk toestaan).
  let selectedColor = todo.color || null;
  const colorSel = document.createElement('div');
  colorSel.className = 'color-selector';
  const noneSwatch = document.createElement('button');
  noneSwatch.type = 'button';
  noneSwatch.className = 'color-swatch color-swatch-none';
  noneSwatch.title = 'Geen kleur';
  noneSwatch.setAttribute('aria-label', 'Geen kleur');
  noneSwatch.classList.toggle('selected', !selectedColor);
  colorSel.appendChild(noneSwatch);
  const swatchEls = [noneSwatch];
  for (const c of TODO_COLORS) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'color-swatch';
    sw.style.setProperty('--swatch-color', c);
    sw.title = c;
    sw.setAttribute('aria-label', `Kleur ${c}`);
    sw.classList.toggle('selected', selectedColor === c);
    sw.addEventListener('click', () => {
      selectedColor = c;
      for (const s of swatchEls) s.classList.remove('selected');
      sw.classList.add('selected');
    });
    colorSel.appendChild(sw);
    swatchEls.push(sw);
  }
  noneSwatch.addEventListener('click', () => {
    selectedColor = null;
    for (const s of swatchEls) s.classList.remove('selected');
    noneSwatch.classList.add('selected');
  });
  el.appendChild(colorSel);

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  actions.appendChild(
    makeBtn('Opslaan', () => saveTodoEdit(todo.id, ta.value, [...selected], selectedColor)),
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
  for (const el of allTodoEls(todo.id)) el.remove(); // defensief
  for (const container of containersFor(todo)) container.prepend(buildTodoEl(todo));
  applyFilter();
}

function updateTodo(todo) {
  const prev = todos.get(todo.id);
  todos.set(todo.id, todo);
  const existingEls = allTodoEls(todo.id);
  if (existingEls.some((el) => el.classList.contains('editing'))) return; // niet clobberen

  if (existingEls.length && prev && !!prev.done !== !!todo.done) {
    // Done-state gewisseld → uit alle containers halen en opnieuw plaatsen.
    for (const el of existingEls) el.remove();
    for (const container of containersFor(todo)) container.prepend(buildTodoEl(todo));
  } else if (existingEls.length) {
    // In-place her-renderen op elke plek waar het item al staat, zodat de
    // positie in de lijst behouden blijft.
    for (const el of existingEls) renderTodoView(el, todo);
  } else {
    for (const container of containersFor(todo)) container.prepend(buildTodoEl(todo));
  }
  applyFilter();
}

function removeTodo(id) {
  todos.delete(id);
  for (const el of allTodoEls(id)) el.remove();
  updateEmptyStates();
}

async function loadTodos() {
  const res = await fetch('/api/todos');
  const rows = await res.json(); // op position
  todos.clear();
  openTodosEl.innerHTML = '';
  doneTodosEl.innerHTML = '';
  homeTodosListEl.innerHTML = '';
  for (const t of rows) {
    todos.set(t.id, t);
    for (const container of containersFor(t)) container.appendChild(buildTodoEl(t));
  }
  applyFilter();
}

// Verschuif een open to-do één plek en persisteer de nieuwe volgorde.
// Optimistisch: lokaal meteen herbouwen, dan naar de server (net als
// moveWithinGroup voor de watchlist).
/* ---------- Slepen om te herordenen (ingedrukt houden, Pointer Events) ----
 * Vervangt de ▲▼-knoppen. Druk een open to-do in en houd ~300ms vast om 'm
 * te kunnen verslepen; beweegt de vinger/muis vóór die tijd meer dan een
 * paar pixels (scrollen, per ongeluk aanraken), dan wordt de sleep-intentie
 * geannuleerd en gebeurt er niets — zo blijft normaal scrollen op mobiel
 * gewoon werken. Live herordenen tijdens het slepen (rij wisselt van plek
 * zodra de aanwijzer een buur passeert); bij loslaten gaat de nieuwe
 * volgorde naar de server via het bestaande /api/todos/reorder-endpoint.
 */
const DRAG_HOLD_MS = 300;
const DRAG_MOVE_CANCEL_PX = 8;

function enableTodoDrag(el, getTodo) {
  let holdTimer = null;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let activePointerId = null;

  function clearHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
    el.removeEventListener('pointermove', onMoveDuringHold);
  }

  function onMoveDuringHold(e) {
    if (Math.abs(e.clientX - startX) > DRAG_MOVE_CANCEL_PX || Math.abs(e.clientY - startY) > DRAG_MOVE_CANCEL_PX) {
      clearHold();
    }
  }

  function onPointerDown(e) {
    const todo = getTodo();
    if (!todo || todo.done) return; // afgeronde items zijn niet sleepbaar
    if (e.target.closest('button, textarea, input, a')) return; // knoppen ongemoeid laten
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Zonder dit selecteert de browser de tekst waar de muis overheen sleept
    // (native tekstselectie-gedrag bij ingedrukt-houden), wat er knullig
    // uitziet. Alleen voor muis: op touch zou preventDefault hier scrollen
    // kunnen blokkeren nog vóórdat we weten of dit een tik of een sleep wordt.
    if (e.pointerType === 'mouse') e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    activePointerId = e.pointerId;
    el.addEventListener('pointermove', onMoveDuringHold);
    el.addEventListener('pointerup', onPointerUpBeforeHold, { once: true });
    el.addEventListener('pointercancel', onPointerUpBeforeHold, { once: true });
    holdTimer = setTimeout(() => startDrag(e), DRAG_HOLD_MS);
  }

  function onPointerUpBeforeHold() {
    clearHold();
  }

  function startDrag(e) {
    clearHold();
    dragging = true;
    try { el.setPointerCapture(activePointerId); } catch { /* niet fataal */ }
    el.classList.add('todo-dragging');
    el.style.touchAction = 'none';
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd, { once: true });
    document.addEventListener('pointercancel', onDragEnd, { once: true });
  }

  function onDragMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const container = el.parentElement;
    if (!container) return;
    const items = [...container.querySelectorAll(':scope > .todo')];
    const dragIdx = items.indexOf(el);
    const y = e.clientY;
    for (let i = 0; i < items.length; i++) {
      if (items[i] === el) continue;
      const rect = items[i].getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (i < dragIdx && y < mid) {
        container.insertBefore(el, items[i]);
        break;
      }
      if (i > dragIdx && y > mid) {
        container.insertBefore(el, items[i].nextSibling);
        break;
      }
    }
  }

  async function onDragEnd() {
    dragging = false;
    el.classList.remove('todo-dragging');
    el.style.touchAction = '';
    document.removeEventListener('pointermove', onDragMove);

    const container = el.parentElement;
    const openIdsInContainer = [...container.querySelectorAll(':scope > .todo')].map((n) => Number(n.dataset.id));
    const doneIds = [...todos.values()].filter((t) => t.done).map((t) => t.id);
    try {
      await fetch('/api/todos/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...openIdsInContainer, ...doneIds] }),
      });
      // Server broadcast todo:reorder → loadTodos() ververst beide
      // containers (hoofdpagina + Home) consistent met de nieuwe volgorde.
    } catch {
      loadTodos(); // bij een fout terug naar de serverwaarheid
    }
  }

  el.addEventListener('pointerdown', onPointerDown);
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

async function saveTodoEdit(id, raw, labelIds, color) {
  const text = raw.trim();
  if (!text) return;
  const body = { text };
  if (Array.isArray(labelIds)) body.labels = labelIds;
  if (color !== undefined) body.color = color;
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
    for (const el of allTodoEls(updated.id)) renderTodoView(el, updated);
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
  source.addEventListener('todo:reorder', () => {
    // volgorde elders gewijzigd → serverwaarheid ophalen en opnieuw tekenen
    loadTodos();
  });
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
  // Rentes ververst de server 1x per dag; dan de KPI-kaarten bijwerken.
  source.addEventListener('rates:update', () => { loadRates(); });
  // Movers ververst de server elke 30 min.
  source.addEventListener('movers:update', () => { loadMovers(); });

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
  source.addEventListener('watchlist:reorder', () => {
    // volgorde elders gewijzigd → serverwaarheid ophalen en opnieuw tekenen
    loadWatchlist();
  });
}

/* ---------- Init ---------- */
loadMessages();
loadLabels();
loadTodos();
loadWatchlist().then(loadQuotes);
loadStockNews();
loadFeedNews();
loadRates();
loadMovers();
connectSSE();
setView('home'); // default: dashboard/home

// Koersen elke 60s (matcht server-cache).
setInterval(loadQuotes, 60 * 1000);
// Nieuws elke 15 min (matcht server-cache 15 min).
setInterval(loadStockNews, 15 * 60 * 1000);
setInterval(loadFeedNews, 15 * 60 * 1000);
// Movers elke 30 min (matcht server-cache).
setInterval(loadMovers, 30 * 60 * 1000);
// Markt-status/"bijgewerkt"-tekst tikt door, ook zonder nieuwe koersdata.
updateMarketStatus();
setInterval(updateMarketStatus, 30 * 1000);

/* ---------- PWA service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => console.warn('SW-registratie mislukt:', err));
  });
}
