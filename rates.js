'use strict';

/**
 * Rentes — spaarrente en hypotheekrente (fase 12, vervroegd op verzoek).
 *
 * Geen officiële gratis API voor NL/EU spaar-/hypotheekrentes bestaat, dus
 * dit is een best-effort scraper — expliciet fragieler dan quotes.js, dat
 * op echte API's draait. Bron: actuelerentestanden.nl, robots.txt staat
 * scrapen van deze publieke pagina's toe.
 *
 * - Sparrente: de "vrij opneembaar sparen"-tabel op de homepage. Dit zijn
 *   vooral pan-Europese fintech-banken (Revolut, Bunq, Trade Republic e.d.)
 *   die in NL opereren — geen NL-grootbanken-tabel, op verzoek.
 * - Hypotheekrente: ABN AMRO-specifieke pagina (op verzoek, i.p.v. "welke
 *   bank toevallig het goedkoopst is"), 10 jaar vast met NHG, product
 *   "Woning Hypotheek" (hun standaard hypotheek; er is ook een goedkopere
 *   "Budget"-variant, maar Woning is representatiever voor "de rente van
 *   ABN AMRO" in het algemeen).
 *
 * Parsing is regex-based i.p.v. een HTML-parser-dependency (cheerio e.d.):
 * de tabellen hebben stabiele, semantische class-namen en de site levert
 * bruikbare data-order-attributen (rate als kommagetal), dus regex is hier
 * voldoende en scheelt een dependency.
 *
 * Trendgrafiek: er bestaat geen gratis historische-rente-API, dus we bouwen
 * onze eigen geschiedenis op door dagelijks de gescrapete waarde weg te
 * schrijven (rate_history-tabel in db.js). Dat betekent: de grafiek is de
 * eerste dagen leeg/vlak (sparklineSvg tekent pas vanaf 3 punten) en wordt
 * pas na enkele weken tot maanden echt indicatief voor een 3-6 maanden
 * trend — een bewuste, uitgelegde beperking, geen bug.
 *
 * Bij een parse-fout (site heeft HTML gewijzigd): vorige waarde + leeftijd
 * blijven tonen, nooit crashen — net als quotes.js bij een API-storing.
 * Ververst 1x per dag: deze rentes bewegen traag, dagelijks is ruim genoeg.
 */

const { db } = require('./db');

const SAVINGS_URL = 'https://www.actuelerentestanden.nl/';
const MORTGAGE_URL = 'https://www.actuelerentestanden.nl/hypotheek/rente/abn-amro';
const REFRESH_MS = 24 * 60 * 60 * 1000; // 1x per dag
const FETCH_TIMEOUT_MS = 15000;
const HISTORY_DAYS = 180; // ruim genoeg voor een 3-6 maanden trend

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; JanApp/1.0; personal-dashboard)' };

let cache = { savings: null, mortgage: null, ts: 0, error: null };

/* ---------- geschiedenis (voor de indicatieve trendgrafiek) ---------- */
const upsertHistory = db.prepare(
  `INSERT INTO rate_history (metric, date, rate) VALUES (?, ?, ?)
   ON CONFLICT(metric, date) DO UPDATE SET rate = excluded.rate`,
);

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());
}

// Oud->nieuw, zoals sparklineSvg (frontend) verwacht.
function historySpark(metric) {
  const rows = db
    .prepare('SELECT rate FROM rate_history WHERE metric = ? ORDER BY date DESC LIMIT ?')
    .all(metric, HISTORY_DAYS);
  return rows.map((r) => r.rate).reverse();
}

/* ---------- parsing ---------- */
// Vrij opneembaar sparen, hoogste rente bovenaan:
// <td class="company imp">Naam</td><td class="rate ... focus-column">X,XX%</td>
function parseSavings(html) {
  const table = html.match(/finckers-table-savings[\s\S]*?<\/table>/i);
  if (!table) return null;
  const rowRe = /<td class="company imp">([^<]+)<\/td>\s*<td class="rate[^"]*">([\d,]+)%/g;
  const rows = [];
  let m;
  while ((m = rowRe.exec(table[0]))) {
    const rate = parseFloat(m[2].replace(',', '.'));
    if (Number.isFinite(rate)) rows.push({ name: m[1].trim(), rate });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.rate - a.rate); // defensief; staat al gesorteerd op de site
  return rows[0];
}

// ABN AMRO-pagina heeft twee producttabellen (Budget + Woning). We pakken
// "Woning" (hun standaard hypotheek); bij een layoutwijziging valt hij terug
// op de eerste gevonden tabel i.p.v. helemaal niets te tonen.
function parseMortgage(html) {
  const tables = html.match(
    /<table class="finckers-datatable finckers-table-mortgage finckers-table-mortgage-product"[^>]*>[\s\S]*?<\/table>/g,
  );
  if (!tables || !tables.length) return null;
  const table = tables.find((t) => /ffa_product=Woning/.test(t)) || tables[0];
  const m = table.match(/data-order=10>10 jaar<\/td>\s*<td data-order=([\d.]+)>/);
  if (!m) return null;
  const rate = parseFloat(m[1]);
  if (!Number.isFinite(rate)) return null;
  return { years: 10, bank: 'ABN AMRO', product: 'Woning Hypotheek', rate };
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
  const today = todayStr();
  let savings = null;
  let mortgage = null;
  let error = null;

  try {
    savings = parseSavings(await fetchHtml(SAVINGS_URL));
  } catch (err) {
    error = `sparrente: ${err.message || err}`;
  }
  try {
    mortgage = parseMortgage(await fetchHtml(MORTGAGE_URL));
  } catch (err) {
    error = error ? `${error}; hypotheekrente: ${err.message || err}` : `hypotheekrente: ${err.message || err}`;
  }
  if (!savings && !mortgage && !error) {
    error = 'kon geen van beide tabellen vinden — site-structuur gewijzigd?';
  }

  if (savings) upsertHistory.run('savings', today, savings.rate);
  if (mortgage) upsertHistory.run('mortgage_abn_10y', today, mortgage.rate);

  // Eén van de twee kan missen zonder de andere te verliezen.
  cache = {
    savings: savings || cache.savings,
    mortgage: mortgage || cache.mortgage,
    ts: Date.now(),
    error,
  };
  if (broadcast) broadcast('rates:update', { generated_at: Date.now() });
}

function snapshot() {
  return {
    savings: cache.savings ? { ...cache.savings, spark: historySpark('savings') } : null,
    mortgage: cache.mortgage ? { ...cache.mortgage, spark: historySpark('mortgage_abn_10y') } : null,
    updated_at: cache.ts || null,
    error: cache.error,
    source: 'actuelerentestanden.nl',
  };
}

function start(broadcast) {
  refresh(broadcast).catch((e) => console.error('[rates] eerste refresh faalde:', e.message));
  setInterval(() => {
    refresh(broadcast).catch((e) => console.error('[rates] refresh faalde:', e.message));
  }, REFRESH_MS);
}

module.exports = { start, snapshot, refresh };
