'use strict';

/**
 * Koersen — fase 5.
 *
 * Waarom niet (meer) Finnhub: het gratis plan heeft géén historische candles.
 * Daarom accumuleerde de oude opzet dagcloses uit losse /quote-calls, waardoor
 * 5d/21d/63d/YTD pas na weken tot maanden gevuld zijn. Bovendien is Finnhub
 * free US-only, terwijl de watchlist grotendeels Nederlands is.
 *
 * Drie bronnen, gekozen op wat ze daadwerkelijk kunnen:
 *   twelvedata  US-aandelen & ETF's + forex. Echte dagcandles. 8 credits/min.
 *   eodhd       Euronext Amsterdam / Warschau e.d. Moet server-side: EODHD
 *               stuurt geen Access-Control-Allow-Origin, dus een browser mag
 *               die API niet rechtstreeks aanroepen.
 *   moex (ISS)  Moskou. Gratis, geen key.
 *
 * Bron wordt afgeleid uit het suffix van de ticker, zodat de watchlist
 * configureerbaar blijft in de app (geen hardcoded lijst):
 *   AAPL      -> twelvedata      ASML.AS -> eodhd
 *   CDR.WA    -> eodhd (.WAR)    OZON.ME -> moex
 *
 * Rate-limits: we halen niet op verzoek op, maar via een scheduler die de
 * hele watchlist elke REFRESH_MS ververst en het resultaat in geheugen +
 * de prices-tabel zet. /api/quotes serveert dus altijd direct een snapshot.
 */

const fs = require('node:fs');
const path = require('node:path');
const { db, DATA_DIR } = require('./db');

const TD_KEY = () => process.env.TWELVEDATA_API_KEY || '';
const EOD_KEY = () => process.env.EODHD_API_KEY || '';

const REFRESH_MS = 15 * 60 * 1000;   // hele watchlist elke 15 min
const TD_PER_MIN = 8;                // gratis plan: 8 credits/minuut
const HISTORY_DAYS = 420;            // ruim genoeg voor 63 handelsdagen + YTD

/* snapshot: ticker -> {price, prev_close, currency, deltas, error, ts} */
const SNAPSHOT = new Map();
let lastRun = 0;
let running = false;

/* ---------- prices-tabel (bestaand schema, nu met échte historie) ---------- */
const upsertPrice = db.prepare(
  `INSERT INTO prices (ticker, date, close) VALUES (?, ?, ?)
   ON CONFLICT(ticker, date) DO UPDATE SET close = excluded.close`,
);
// node:sqlite (DatabaseSync) kent geen .transaction() — dat is better-sqlite3.
// Handmatig een transactie: honderden losse inserts zijn anders traag.
function insertBars(ticker, bars) {
  db.exec('BEGIN');
  try {
    for (const b of bars) upsertPrice.run(ticker, b.date, b.close);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* ---------- bron-routering ---------- */
const EOD_SUFFIXES = /\.(AS|WA|WAR|PA|DE|BR|MI|MC|LS|ST|CO|HE|OL|VI|IR|L|SW)$/;

function route(ticker) {
  const t = String(ticker).toUpperCase();
  if (t.endsWith('.ME')) return { src: 'moex', sym: t.slice(0, -3) };
  if (EOD_SUFFIXES.test(t)) {
    // EODHD gebruikt .WAR voor Warschau; .WA is de gangbare korte notatie.
    return { src: 'eod', sym: t.replace(/\.WA$/, '.WAR') };
  }
  return { src: 'td', sym: t };
}

/* ---------- Twelve Data credit-poort ----------
 * Het gratis plan staat 8 credits per minuut toe. Eerder telde ik credits per
 * refresh-ronde, maar dat weet niets van wat er vlak daarvóór is verbruikt —
 * bij een herstart binnen dezelfde minuut sneuvelde het hele eerste blok.
 * Deze poort houdt een voortschrijdend venster van 60s bij en geldt voor élke
 * Twelve Data-call (koersen én de wisselkoers). */
const tdCalls = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tdGate() {
  for (;;) {
    const now = Date.now();
    while (tdCalls.length && now - tdCalls[0] > 60000) tdCalls.shift();
    if (tdCalls.length < TD_PER_MIN) {
      // check + push is synchroon, dus twee wachters kunnen niet dezelfde slot pakken
      tdCalls.push(now);
      return;
    }
    await sleep(60000 - (now - tdCalls[0]) + 250);
  }
}

/* ---------- bronnen: leveren allemaal bars nieuw->oud ---------- */
async function seriesTwelveData(sym) {
  const key = TD_KEY();
  if (!key) throw new Error('TWELVEDATA_API_KEY niet ingesteld');
  await tdGate();
  const p = new URLSearchParams({
    symbol: sym, interval: '1day', outputsize: '400', order: 'desc', apikey: key,
  });
  const r = await fetch(`https://api.twelvedata.com/time_series?${p}`);
  const j = await r.json();
  if (j.status === 'error' || j.code >= 400) throw new Error(j.message || `HTTP ${j.code}`);
  if (!Array.isArray(j.values) || j.values.length < 2) throw new Error('geen koersdata');
  return {
    bars: j.values.map((v) => ({ date: v.datetime.slice(0, 10), close: parseFloat(v.close) }))
      .filter((b) => Number.isFinite(b.close)),
    currency: (j.meta && j.meta.currency) || 'USD',
  };
}

async function seriesEodhd(sym) {
  const key = EOD_KEY();
  if (!key) throw new Error('EODHD_API_KEY niet ingesteld');
  const from = new Date(Date.now() - HISTORY_DAYS * 864e5).toISOString().slice(0, 10);
  const p = new URLSearchParams({ api_token: key, fmt: 'json', period: 'd', from });
  const r = await fetch(`https://eodhd.com/api/eod/${encodeURIComponent(sym)}?${p}`);
  if (!r.ok) {
    if (r.status === 401) throw new Error('EODHD-key ongeldig');
    if (r.status === 402) throw new Error('niet in EODHD-plan');
    throw new Error(`EODHD HTTP ${r.status}`);
  }
  const j = await r.json();
  if (!Array.isArray(j) || j.length < 2) throw new Error('geen koersdata (symbool?)');
  const bars = j
    .map((v) => ({ date: v.date, close: parseFloat(v.adjusted_close ?? v.close) }))
    .filter((b) => Number.isFinite(b.close))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return { bars, currency: guessCurrency(sym) };
}

async function seriesMoex(sym) {
  const from = new Date(Date.now() - HISTORY_DAYS * 864e5).toISOString().slice(0, 10);
  const url =
    'https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/' +
    `${encodeURIComponent(sym)}/candles.json?from=${from}&interval=24`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`MOEX HTTP ${r.status}`);
  const j = await r.json();
  const c = j.candles;
  if (!c || !Array.isArray(c.data) || c.data.length < 2) throw new Error('geen koersdata (ticker?)');
  const ic = c.columns.indexOf('close');
  const ie = c.columns.indexOf('end');
  const bars = c.data
    .map((v) => ({ date: String(v[ie]).slice(0, 10), close: parseFloat(v[ic]) }))
    .filter((b) => Number.isFinite(b.close))
    .reverse();
  return { bars, currency: 'RUB' };
}

function guessCurrency(sym) {
  if (/\.WAR?$/.test(sym)) return 'PLN';
  if (/\.(L|SW)$/.test(sym)) return sym.endsWith('.L') ? 'GBP' : 'CHF';
  return 'EUR';
}

/* ---------- EUR/RUB, om roebels als bedrag in euro te tonen ---------- */
/* Persistent op schijf: een herstart hoeft de koers dan niet opnieuw op te
   halen (belangrijk, want vlak na een herstart is Twelve Data's minuutlimiet
   account-breed vaak nog vol → de fx-call faalt en Ozon bleef dan tot de
   volgende ronde in roebels staan). */
const FX_FILE = path.join(DATA_DIR, 'fx-eurrub.json');
const FX_TTL = 6 * 60 * 60 * 1000;
const FX_STALE_OK = 7 * 24 * 60 * 60 * 1000; // als fallback tot een week oud bruikbaar

let fxCache = { rate: null, ts: 0 };
let fxInflight = null;
try {
  const saved = JSON.parse(fs.readFileSync(FX_FILE, 'utf8'));
  if (saved && Number.isFinite(saved.rate) && saved.rate > 0) fxCache = saved;
} catch { /* nog geen bestand — eerste run */ }

// De koers om te rekenen: vers uit cache, of desnoods een oude als fallback.
function fxRate() {
  return (fxCache.rate && Date.now() - fxCache.ts < FX_STALE_OK) ? fxCache.rate : null;
}

async function eurRub() {
  if (fxCache.rate && Date.now() - fxCache.ts < FX_TTL) return fxCache.rate;
  // Eén gedeelde call: zonder dit vroeg elke MOEX-ticker parallel z'n eigen
  // wisselkoers op (meerdere credits + race).
  if (fxInflight) return fxInflight;
  const key = TD_KEY();
  if (!key) return null;
  fxInflight = (async () => {
    try {
      await tdGate();
      const p = new URLSearchParams({
        symbol: 'EUR/RUB', interval: '1day', outputsize: '1', order: 'desc', apikey: key,
      });
      const j = await (await fetch(`https://api.twelvedata.com/time_series?${p}`)).json();
      const rate = parseFloat(j?.values?.[0]?.close);
      if (Number.isFinite(rate) && rate > 0) {
        fxCache = { rate, ts: Date.now() };
        try { fs.writeFileSync(FX_FILE, JSON.stringify(fxCache)); } catch { /* niet fataal */ }
        return rate;
      }
    } catch { /* fx is bijzaak: zonder koers tonen we gewoon roebels */ }
    return null;
  })().finally(() => { fxInflight = null; });
  return fxInflight;
}

/* ---------- deltas ---------- */
// bars zijn nieuw->oud. Delta over N handelsdagen = t.o.v. bars[N].
function deltaBars(bars, n) {
  if (bars.length <= n) return null;
  const last = bars[0].close;
  const ref = bars[n].close;
  return ref ? (last - ref) / ref : null;
}

function deltaYTD(bars) {
  const year = new Date().getUTCFullYear();
  // oudste bar binnen dit jaar = eerste handelsdag
  let ref = null;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].date >= `${year}-01-01`) { ref = bars[i].close; break; }
  }
  if (!ref) return null;
  return (bars[0].close - ref) / ref;
}

/* ~30 slotkoersen, oud->nieuw, voor de sparkline in de UI.
   Voor roebels rekenen we het bedrag om (zelfde als de getoonde koers), zodat
   de lijn in dezelfde eenheid staat. De vorm blijft identiek — alleen de schaal
   verschilt, en de sparkline is toch schaalloos. */
function sparkFrom(bars, rate) {
  const closes = bars.slice(0, 30).reverse().map((b) => b.close);
  if (rate) return closes.map((c) => c / rate);
  return closes;
}

/* ---------- één ticker ophalen ---------- */
async function fetchTicker(ticker) {
  const { src, sym } = route(ticker);
  const s = src === 'td' ? await seriesTwelveData(sym)
    : src === 'eod' ? await seriesEodhd(sym)
      : await seriesMoex(sym);

  const bars = s.bars;
  if (!bars || bars.length < 2) throw new Error('geen koersdata');

  // Historie wegschrijven: de prices-tabel is nu meteen gevuld i.p.v. dat hij
  // zich maandenlang moet opsparen. Dient tevens als fallback bij API-storing.
  insertBars(ticker, bars.slice(0, 200));

  let price = bars[0].close;
  let currency = s.currency;
  let fxUsed = null;

  /* Roebels: percentages blijven op de RUB-reeks (zuivere performance van het
     aandeel, zonder valuta-effect); alleen het bedrag tonen we in euro.
     Verse koers proberen, anders de laatst bekende (fxRate) — beter een dag
     oude wisselkoers dan een roebelbedrag naast euro-genoteerde buren. */
  if (currency === 'RUB') {
    const rate = (await eurRub()) || fxRate();
    if (rate) { price = bars[0].close / rate; currency = 'EUR'; fxUsed = rate; }
  }

  return {
    ticker,
    price,
    prev_close: bars[1].close,
    currency,
    deltas: {
      d1: deltaBars(bars, 1),
      d5: deltaBars(bars, 5),
      d21: deltaBars(bars, 21),
      d63: deltaBars(bars, 63),
      ytd: deltaYTD(bars),
    },
    spark: sparkFrom(bars, fxUsed),
    error: null,
    ts: Date.now(),
  };
}

/* ---------- scheduler ---------- */
async function refreshAll(broadcast) {
  if (running) return;
  running = true;
  try {
    const list = db.prepare('SELECT ticker FROM watchlist ORDER BY added_at ASC').all();

    /* Wisselkoers als éérste in de gate-rij zetten, zodat MOEX-tickers meteen
       naar euro kunnen. Anders belandt de fx-call achter de US-tickers en toont
       Ozon minutenlang roebels. Niet awaiten: hij deelt de in-flight call. */
    if (TD_KEY() && list.some((w) => route(w.ticker).src === 'moex')) eurRub();

    /* Alles tegelijk starten: de credit-poort hierboven doseert de Twelve
       Data-calls vanzelf, en EODHD/MOEX hebben geen krappe minuutlimiet.
       Zodra een ticker binnen is, ziet de UI 'm — hij hoeft niet op de
       traagste te wachten. */
    await Promise.all(list.map(async (w) => {
      await runOne(w.ticker);
      if (broadcast) broadcast('quotes:update', { generated_at: Date.now() });
    }));

    lastRun = Date.now();
    if (broadcast) broadcast('quotes:update', { generated_at: lastRun });
  } finally {
    running = false;
  }
}

const RATE_LIMIT_RE = /credit|rate limit|too many|429/i;

async function runOne(ticker, attempt = 0) {
  try {
    SNAPSHOT.set(ticker, await fetchTicker(ticker));
  } catch (err) {
    const msg = String(err.message || err);

    /* Een rate-limit is tijdelijk. Zonder retry bleef zo'n ticker 15 minuten
       op "fout" staan tot de volgende ronde — dat is geen fout, dat is drukte. */
    if (RATE_LIMIT_RE.test(msg) && attempt < 2) {
      await sleep(62000);
      return runOne(ticker, attempt + 1);
    }

    const prev = SNAPSHOT.get(ticker);
    SNAPSHOT.set(ticker, {
      ticker,
      // laatst bekende koers blijven tonen i.p.v. de regel leeg te gooien
      price: prev?.price ?? null,
      prev_close: prev?.prev_close ?? null,
      currency: prev?.currency ?? null,
      deltas: prev?.deltas ?? { d1: null, d5: null, d21: null, d63: null, ytd: null },
      spark: prev?.spark ?? null,
      error: msg.slice(0, 90),
      ts: Date.now(),
    });
  }
  return undefined;
}

/* Losse ticker meteen ophalen (bij toevoegen aan de watchlist). */
async function refreshTicker(ticker, broadcast) {
  await runOne(ticker);
  if (broadcast) broadcast('quotes:update', { generated_at: Date.now() });
}

function snapshot() {
  const list = db.prepare('SELECT ticker, display_name FROM watchlist ORDER BY added_at ASC').all();
  const quotes = list.map((w) => {
    const s = SNAPSHOT.get(w.ticker);
    if (!s) {
      // Nog niet opgehaald is géén fout: error blijft null, de UI toont "laden…".
      return { ticker: w.ticker, display_name: w.display_name, price: null, error: null,
        deltas: { d1: null, d5: null, d21: null, d63: null, ytd: null } };
    }
    return { ...s, display_name: w.display_name };
  });
  return { generated_at: lastRun || Date.now(), quotes };
}

/* Het snapshot leeft in geheugen en is dus weg na een herstart — en een deploy
   is een herstart. Zonder dit stond de tabel na elke deploy ~2,5 minuut op
   "laden…" (Twelve Data doet 8 tickers per minuut). De prices-tabel bevat de
   historie al, dus daar bouwen we bij het opstarten meteen een snapshot uit.
   De live ronde overschrijft het zodra hij binnen is. */
function hydrateFromDb() {
  const list = db.prepare('SELECT ticker FROM watchlist').all();
  const q = db.prepare(
    'SELECT date, close FROM prices WHERE ticker = ? ORDER BY date DESC LIMIT 200',
  );
  let n = 0;
  for (const w of list) {
    const bars = q.all(w.ticker);
    if (bars.length < 2) continue;
    const { src, sym } = route(w.ticker);
    // Valuta staat niet in de prices-tabel; leiden we af uit de bron.
    let currency = src === 'td' ? 'USD' : src === 'moex' ? 'RUB' : guessCurrency(sym);
    let price = bars[0].close;
    let rate = null;
    // Roebels meteen omrekenen met de opgeslagen wisselkoers, zodat Ozon ook
    // bij het opstarten in euro staat i.p.v. tot de eerste live ronde in ₽.
    if (currency === 'RUB' && (rate = fxRate())) { price = bars[0].close / rate; currency = 'EUR'; }
    SNAPSHOT.set(w.ticker, {
      ticker: w.ticker,
      price,
      prev_close: bars[1].close,
      currency,
      deltas: {
        d1: deltaBars(bars, 1),
        d5: deltaBars(bars, 5),
        d21: deltaBars(bars, 21),
        d63: deltaBars(bars, 63),
        ytd: deltaYTD(bars),
      },
      spark: sparkFrom(bars, rate),
      error: null,
      ts: Date.now(),
    });
    n++;
  }
  if (n) console.log(`[quotes] ${n} tickers uit de database geladen (tot de live ronde binnen is)`);
}

function start(broadcast) {
  const keys = [];
  if (!TD_KEY()) keys.push('TWELVEDATA_API_KEY');
  if (!EOD_KEY()) keys.push('EODHD_API_KEY');
  if (keys.length) {
    console.warn(`[quotes] ontbrekende env-vars: ${keys.join(', ')} — die tickers falen.`);
  }
  hydrateFromDb();
  refreshAll(broadcast).catch((e) => console.error('[quotes] eerste refresh faalde:', e.message));
  setInterval(() => {
    refreshAll(broadcast).catch((e) => console.error('[quotes] refresh faalde:', e.message));
  }, REFRESH_MS);
}

module.exports = { start, snapshot, refreshAll, refreshTicker, route };
