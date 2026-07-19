'use strict';

/**
 * Rentes — spaarrente en hypotheekrente (fase 12, vervroegd op verzoek).
 *
 * Geen officiële gratis API voor NL spaar-/hypotheekrentes bestaat, dus dit
 * is een best-effort scraper — expliciet fragieler dan quotes.js, dat op
 * echte API's draait. Bron: actuelerentestanden.nl, één pagina met beide
 * tabellen, "dagelijks bijgewerkt" volgens de site zelf, robots.txt staat
 * scrapen van deze publieke pagina's toe (alleen /wp-admin/ is dicht).
 *
 * Parsing is regex-based i.p.v. een HTML-parser-dependency (cheerio e.d.):
 * de tabellen hebben stabiele, semantische class-namen en de site levert
 * bruikbare data-order-attributen (rate als kommagetal, periode in maanden),
 * dus regex is hier voldoende en scheelt een dependency.
 *
 * Bij een parse-fout (site heeft HTML gewijzigd): vorige waarde + leeftijd
 * blijven tonen, nooit crashen — net als quotes.js bij een API-storing.
 * Ververst 1x per dag: deze rentes bewegen traag, dagelijks is ruim genoeg.
 */

const RATES_URL = 'https://www.actuelerentestanden.nl/';
const REFRESH_MS = 24 * 60 * 60 * 1000; // 1x per dag
const FETCH_TIMEOUT_MS = 15000;

let cache = { savings: null, mortgage: null, ts: 0, error: null };

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

// 10 jaar vast met NHG — meest gangbare referentie in NL hypotheek-vergelijkingen.
// <td class=period data-order=MAANDEN>...</td><td class=product ...><a title="...">Bank</a></td>
// <td class="number focus-column" data-order=RENTE>...
function parseMortgage(html) {
  const table = html.match(/finckers-table-mortgage-cheapest[\s\S]*?<\/table>/i);
  if (!table) return null;
  const rowRe =
    /<td class=period data-order=(\d+)>[\s\S]*?<td class=product[^>]*>\s*<a[^>]*title="[^"]*">([^<]+)<\/a>[\s\S]*?<td class="number focus-column" data-order=([\d.]+)>/g;
  let m;
  let tenYear = null;
  while ((m = rowRe.exec(table[0]))) {
    const years = Math.round(parseInt(m[1], 10) / 12);
    const rate = parseFloat(m[3]);
    if (years === 10 && Number.isFinite(rate)) {
      tenYear = { years, bank: m[2].trim(), rate };
      break;
    }
  }
  return tenYear;
}

async function fetchRates() {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(RATES_URL, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JanApp/1.0; personal-dashboard)' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const savings = parseSavings(html);
    const mortgage = parseMortgage(html);
    if (!savings && !mortgage) {
      throw new Error('kon geen van beide tabellen vinden — site-structuur gewijzigd?');
    }
    return { savings, mortgage };
  } finally {
    clearTimeout(timeout);
  }
}

async function refresh(broadcast) {
  try {
    const { savings, mortgage } = await fetchRates();
    // Eén van de twee tabellen kan missen zonder de andere te verliezen.
    cache = {
      savings: savings || cache.savings,
      mortgage: mortgage || cache.mortgage,
      ts: Date.now(),
      error: null,
    };
  } catch (err) {
    // Vorige waarden blijven staan; alleen de foutmelding bijwerken.
    cache = { ...cache, error: String(err.message || err) };
  }
  if (broadcast) broadcast('rates:update', { generated_at: Date.now() });
}

function snapshot() {
  return {
    savings: cache.savings, // { name, rate } | null
    mortgage: cache.mortgage, // { years, bank, rate } | null
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
