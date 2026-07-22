'use strict';

/**
 * Biggest movers — bewust bùiten je eigen watchlist (die zie je al op de
 * Aandelen-pagina), en bewust GESCOPED.
 *
 * Waarom scoped: de globale grootste stijgers/dalers zijn per definitie
 * nanocap-ruis (alleen een aandeel van $20M beweegt 100% op een dag) — vooral
 * pump-and-dump smallcap-pharma. Dat is geen bruikbare "wat gebeurt er in de
 * markt"-signaal. Daarom filteren we op een universum dat wél interessant is:
 * grote bedrijven (elke sector) én tech/AI (ook kleinere namen).
 *
 * Bron: Yahoo Finance' custom screener. Dat is de enige gratis, keyloze manier
 * om de grootste bewegers BINNEN een sector/marktkap-scope op te halen — de
 * eerdere stockanalysis-scrape gaf alleen de globale top-20 (altijd microcaps),
 * die je niet op sector kon filteren. Yahoo filtert server-side, dus we krijgen
 * meteen alleen de relevante namen terug. Vereist een cookie + "crumb"
 * (Yahoo's CSRF-token); die halen we lazy op en vernieuwen bij een 401.
 *
 * Scope (twee buckets, samengevoegd met OR):
 *   - marktkap ≥ $10B, elke sector      → "grote bedrijven"
 *   - sector = Technology & marktkap ≥ $1B → "(kleinere) tech/AI"
 * Plus: alleen grote US-beurzen (geen illiquide OTC-ADR's met stale koersen),
 * minimale beweging ~2%, en je eigen watchlist eruit.
 */

const { db } = require('./db');

const REFRESH_MS = 30 * 60 * 1000; // 30 min — discovery-content, geen kernfunctie
const FETCH_TIMEOUT_MS = 15000;
const PER_COLUMN = 3;

const LARGE_CAP_USD = 10_000_000_000; // "grote bedrijven": ≥ $10B, elke sector
const TECH_CAP_USD = 1_000_000_000;   // "kleinere tech/AI": Technology & ≥ $1B
const MIN_MOVE_PCT = 2;               // kleiner dan dit is geen "mover"
const SCREEN_SIZE = 25;               // kandidaten per kant vóór filtering

// Yahoo geeft OTC/pink-sheet-ADR's een eigen beurscode; die hebben vaak stale
// koersen (een %-uitschieter die geen echte beweging is). Alleen de grote
// US-beurzen houden we over.
const US_EXCHANGES = new Set(['NMS', 'NGM', 'NCM', 'NYQ', 'ASE', 'PCX', 'BATS']);

const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
};

// okAt = laatste geslaagde ophaal (ts = laatste póging). Bij een fout blijven
// de oude rijen staan; okAt verraadt dan hoe oud ze inmiddels zijn.
let cache = { gainers: [], losers: [], ts: 0, okAt: 0, error: null };

/* ---------- Yahoo cookie + crumb ----------
 * De screener-POST vereist een geldige crumb die bij de sessie-cookie hoort.
 * We cachen beide en vernieuwen bij een 401 (crumb verlopen). */
let auth = { cookie: null, crumb: null };

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { ...UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshAuth() {
  const c = await fetchWithTimeout('https://fc.yahoo.com');
  const cookie = (c.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('geen Yahoo-cookie ontvangen');
  const cr = await fetchWithTimeout('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { Cookie: cookie },
  });
  const crumb = (await cr.text()).trim();
  if (!crumb || crumb.length > 40) throw new Error('geen bruikbare Yahoo-crumb');
  auth = { cookie, crumb };
  return auth;
}

/* Eén kant (gainers of losers) ophalen. dir 'up' => grootste stijgers,
   'down' => grootste dalers. Retryt één keer met een verse crumb bij 401. */
async function screen(dir, retry = true) {
  if (!auth.crumb) await refreshAuth();

  const scope = {
    operator: 'or',
    operands: [
      { operator: 'gt', operands: ['intradaymarketcap', LARGE_CAP_USD] },
      {
        operator: 'and',
        operands: [
          { operator: 'eq', operands: ['sector', 'Technology'] },
          { operator: 'gt', operands: ['intradaymarketcap', TECH_CAP_USD] },
        ],
      },
    ],
  };
  const move = dir === 'up'
    ? { operator: 'gt', operands: ['percentchange', MIN_MOVE_PCT] }
    : { operator: 'lt', operands: ['percentchange', -MIN_MOVE_PCT] };

  const body = {
    size: SCREEN_SIZE,
    offset: 0,
    sortField: 'percentchange',
    sortType: dir === 'up' ? 'DESC' : 'ASC',
    quoteType: 'EQUITY',
    query: { operator: 'and', operands: [{ operator: 'eq', operands: ['region', 'us'] }, move, scope] },
    userId: '',
    userIdType: 'guid',
  };

  const r = await fetchWithTimeout(
    `https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(auth.crumb)}`,
    { method: 'POST', headers: { Cookie: auth.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  if (r.status === 401 && retry) {
    // Crumb/cookie verlopen: ververs en probeer nog één keer.
    await refreshAuth();
    return screen(dir, false);
  }
  if (!r.ok) throw new Error(`Yahoo screener HTTP ${r.status}`);
  const j = await r.json();
  return j?.finance?.result?.[0]?.quotes || [];
}

// Yahoo-quote -> onze rij-vorm. Alleen echte US-beurzen, geen watchlist.
// Yahoo sorteert op zijn interne 'percentchange' (kan intraday/premarket
// meenemen); wij tonen regularMarketChangePercent, dus her-sorteren we op dát
// veld zodat de getoonde volgorde bij de getoonde cijfers past.
function toRows(quotes, watchlistTickers, dir) {
  const out = [];
  for (const q of quotes) {
    const ticker = q.symbol;
    const changePct = q.regularMarketChangePercent;
    if (!ticker || !Number.isFinite(changePct)) continue;
    if (!US_EXCHANGES.has(q.exchange)) continue;
    if (watchlistTickers.has(ticker.toUpperCase())) continue;
    out.push({
      ticker,
      name: q.shortName || q.displayName || ticker,
      changePct,
      marketCapM: Number.isFinite(q.marketCap) ? q.marketCap / 1e6 : null,
    });
  }
  out.sort((a, b) => (dir === 'up' ? b.changePct - a.changePct : a.changePct - b.changePct));
  return out.slice(0, PER_COLUMN);
}

async function refresh(broadcast) {
  try {
    const [gainersQ, losersQ] = await Promise.all([screen('up'), screen('down')]);
    const watchlistTickers = new Set(
      db.prepare('SELECT ticker FROM watchlist').all().map((w) => w.ticker.toUpperCase()),
    );
    const gainers = toRows(gainersQ, watchlistTickers, 'up');
    const losers = toRows(losersQ, watchlistTickers, 'down');

    const now = Date.now();
    cache = { gainers, losers, ts: now, okAt: now, error: null };
  } catch (err) {
    const error = String(err.message || err);
    console.error('[movers] ophalen mislukt:', error);
    cache = { ...cache, ts: Date.now(), error };
  }
  if (broadcast) broadcast('movers:update', { generated_at: Date.now() });
}

function snapshot() {
  return {
    gainers: cache.gainers,
    losers: cache.losers,
    updated_at: cache.ts || null,
    ok_at: cache.okAt || null,
    error: cache.error,
    source: 'Yahoo Finance',
  };
}

function start(broadcast) {
  refresh(broadcast).catch((e) => console.error('[movers] eerste refresh faalde:', e.message));
  setInterval(() => {
    refresh(broadcast).catch((e) => console.error('[movers] refresh faalde:', e.message));
  }, REFRESH_MS);
}

module.exports = { start, snapshot, refresh };
