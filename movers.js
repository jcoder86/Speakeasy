'use strict';

/**
 * Biggest movers — bewust bùiten je eigen watchlist (dat toon je al op de
 * Aandelen-pagina). Twelve Data en EODHD (bestaande, al-gebruikte keys)
 * hebben geen movers/screener-endpoint op hun gratis tier (Twelve Data's
 * `/market_movers` is expliciet Pro-plan-only; EODHD's screener-status op
 * de gratis 20-calls/dag-tier was niet te bevestigen zonder dat budget te
 * riskeren). Daarom, net als bij rates.js: best-effort scrapen.
 *
 * Bron: stockanalysis.com/markets/gainers/ en /losers/ — deze zijn al op
 * %-verandering gesorteerd, dus dit zijn de daadwerkelijk grootste stijgers
 * en dalers (niet "most active by volume", dat gaf vorige versie modeste
 * 1-2%-bewegingen: veelgehandelde large-caps bewegen zelden hard). Keerzijde:
 * de grootste %-bewegers zijn vaak kleinere, minder bekende bedrijven — dat
 * is inherent aan wat "biggest movers" betekent, geen bug. Een lichte
 * marktkapitalisatie-vloer filtert alleen de meest illiquide nanocaps/shells
 * (waar een paar aandelen handel al een %-uitschieter veroorzaakt) eruit.
 *
 * robots.txt van stockanalysis.com staat scrapen toe (alleen specifieke
 * scraper-bots expliciet geblokkeerd, niet algemeen).
 */

const { db } = require('./db');

const GAINERS_URL = 'https://stockanalysis.com/markets/gainers/';
const LOSERS_URL = 'https://stockanalysis.com/markets/losers/';
const REFRESH_MS = 30 * 60 * 1000; // 30 min — discovery-content, geen kernfunctie
const FETCH_TIMEOUT_MS = 15000;
const MIN_MARKET_CAP_M = 10; // $10M — filtert alleen evidente nanocap/shell-ruis
const PER_COLUMN = 3;

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; JanApp/1.0; personal-dashboard)' };

// okAt = laatste geslaagde scrape (ts = laatste póging). Bij een fout blijven
// de oude rijen staan; okAt verraadt dan hoe oud ze inmiddels zijn.
let cache = { gainers: [], losers: [], ts: 0, okAt: 0, error: null };

function parseMarketCap(str) {
  const m = String(str).match(/([\d.]+)\s*([KMBT])/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult = { K: 0.001, M: 1, B: 1000, T: 1_000_000 }[m[2].toUpperCase()];
  return Number.isFinite(n) ? n * mult : null;
}

// Gainers/losers-pagina's: kolomvolgorde na "No." is naam, %change, koers,
// volume, marktcap — andere volgorde dan de (niet meer gebruikte)
// most-active-pagina, dus een eigen parser i.p.v. hergebruik.
function parseMoversPage(html) {
  const tbody = html.match(/<tbody>[\s\S]*?<\/tbody>/);
  if (!tbody) return [];
  const rows = tbody[0].split('<tr').slice(1);
  const out = [];
  for (const r of rows) {
    const symMatch = r.match(/\/stocks\/[a-z0-9.-]+\/">([A-Z0-9.]+)</i);
    if (!symMatch) continue;
    const cells = [...r.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]).filter(Boolean);
    // Volgorde: No., naam, %change, koers, volume, marktcap.
    const [, name, changeStr, priceStr, , capStr] = cells;
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

function filterAndRank(list, watchlistTickers, sortDesc) {
  return list
    .filter((s) => s.marketCapM >= MIN_MARKET_CAP_M && !watchlistTickers.has(s.ticker.toUpperCase()))
    .sort((a, b) => (sortDesc ? b.changePct - a.changePct : a.changePct - b.changePct))
    .slice(0, PER_COLUMN);
}

async function refresh(broadcast) {
  try {
    const [gainersHtml, losersHtml] = await Promise.all([
      fetchHtml(GAINERS_URL),
      fetchHtml(LOSERS_URL),
    ]);
    const gainersAll = parseMoversPage(gainersHtml);
    const losersAll = parseMoversPage(losersHtml);
    if (!gainersAll.length && !losersAll.length) {
      throw new Error('geen rijen gevonden — site-structuur gewijzigd?');
    }

    const watchlistTickers = new Set(
      db.prepare('SELECT ticker FROM watchlist').all().map((w) => w.ticker.toUpperCase()),
    );
    const gainers = filterAndRank(gainersAll, watchlistTickers, true);
    const losers = filterAndRank(losersAll, watchlistTickers, false);

    const now = Date.now();
    cache = { gainers, losers, ts: now, okAt: now, error: null };
  } catch (err) {
    const error = String(err.message || err);
    console.error('[movers] scrape mislukt:', error);
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
