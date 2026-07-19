'use strict';

/**
 * Biggest movers — bewust bùiten je eigen watchlist (dat toon je al op de
 * Aandelen-pagina). Twelve Data en EODHD (bestaande, al-gebruikte keys)
 * hebben geen movers/screener-endpoint op hun gratis tier (Twelve Data's
 * `/market_movers` is expliciet Pro-plan-only; EODHD's screener-status op
 * de gratis 20-calls/dag-tier was niet te bevestigen zonder dat budget te
 * riskeren). Daarom, net als bij rates.js: best-effort scrapen.
 *
 * Bron: stockanalysis.com/markets/active/ — "most active by volume".
 * Bewust niet hun /gainers//losers-pagina's: die zijn vrijwel volledig
 * micro-/penny-stocks (grote %-bewegingen op weinig volume, geen bekende
 * namen). De "most active"-lijst bevat wél herkenbare grote bedrijven
 * (NVDA, NFLX, INTC, ...) en heeft toevallig ook een %-change-kolom, dus
 * uit dezelfde ene fetch halen we zowel "welke aandelen doen ertoe" als
 * "hoe bewegen ze vandaag". robots.txt van stockanalysis.com staat scrapen
 * toe (alleen specifieke scraper-bots expliciet geblokkeerd, niet algemeen).
 *
 * Filter: marktkapitalisatie >= MIN_MARKET_CAP_M (herkenbare bedrijven,
 * geen microcaps) én ticker niet in je eigen watchlist. De statische HTML
 * bevat maar ~15-20 rijen (geen paginering zonder JS), dus op een dag met
 * overwegend rode of groene koersen kan één kolom (stijgers/dalers) dun of
 * leeg uitvallen — inherent aan deze bron, geen bug.
 */

const { db } = require('./db');

const ACTIVE_URL = 'https://stockanalysis.com/markets/active/';
const REFRESH_MS = 30 * 60 * 1000; // 30 min — discovery-content, geen kernfunctie
const FETCH_TIMEOUT_MS = 15000;
const MIN_MARKET_CAP_M = 5000; // $5B — "herkenbaar bedrijf", geen microcap-ruis
const PER_COLUMN = 3;

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; JanApp/1.0; personal-dashboard)' };

let cache = { gainers: [], losers: [], ts: 0, error: null };

function parseMarketCap(str) {
  const m = String(str).match(/([\d.]+)\s*([MBT])/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult = { M: 1, B: 1000, T: 1_000_000 }[m[2].toUpperCase()];
  return Number.isFinite(n) ? n * mult : null;
}

function parseActiveStocks(html) {
  const tbody = html.match(/<tbody>[\s\S]*?<\/tbody>/);
  if (!tbody) return [];
  const rows = tbody[0].split('<tr').slice(1);
  const out = [];
  for (const r of rows) {
    const symMatch = r.match(/\/stocks\/[a-z0-9.-]+\/">([A-Z0-9.]+)</i);
    if (!symMatch) continue;
    const cells = [...r.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]).filter(Boolean);
    // Volgorde: No., naam, volume, koers, %change, marketcap.
    const [, name, , priceStr, changeStr, capStr] = cells;
    const changePct = parseFloat(String(changeStr).replace('%', ''));
    const marketCapM = parseMarketCap(capStr);
    if (!Number.isFinite(changePct) || marketCapM === null) continue;
    out.push({
      ticker: symMatch[1],
      name: name || symMatch[1],
      price: parseFloat(priceStr) || null,
      changePct,
      marketCapM,
    });
  }
  return out;
}

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: UA });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function refresh(broadcast) {
  try {
    const html = await fetchHtml(ACTIVE_URL);
    const all = parseActiveStocks(html);
    if (!all.length) throw new Error('geen rijen gevonden — site-structuur gewijzigd?');

    const watchlistTickers = new Set(
      db.prepare('SELECT ticker FROM watchlist').all().map((w) => w.ticker.toUpperCase()),
    );
    const candidates = all.filter(
      (s) => s.marketCapM >= MIN_MARKET_CAP_M && !watchlistTickers.has(s.ticker.toUpperCase()),
    );

    const gainers = candidates
      .filter((s) => s.changePct > 0)
      .sort((a, b) => b.changePct - a.changePct)
      .slice(0, PER_COLUMN);
    const losers = candidates
      .filter((s) => s.changePct < 0)
      .sort((a, b) => a.changePct - b.changePct)
      .slice(0, PER_COLUMN);

    cache = { gainers, losers, ts: Date.now(), error: null };
  } catch (err) {
    cache = { ...cache, error: String(err.message || err) };
  }
  if (broadcast) broadcast('movers:update', { generated_at: Date.now() });
}

function snapshot() {
  return {
    gainers: cache.gainers,
    losers: cache.losers,
    updated_at: cache.ts || null,
    error: cache.error,
    source: 'stockanalysis.com',
  };
}

function start(broadcast) {
  refresh(broadcast).catch((e) => console.error('[movers] eerste refresh faalde:', e.message));
  setInterval(() => {
    refresh(broadcast).catch((e) => console.error('[movers] refresh faalde:', e.message));
  }, REFRESH_MS);
}

module.exports = { start, snapshot, refresh };
