'use strict';

/**
 * Rentes — ECB-beleidsrente en hypotheekrente.
 *
 * Twee bronnen van heel verschillende kwaliteit, bewust apart behandeld:
 *
 * 1. ECB-depositorente — officiële API (ECB Data Portal), geen key nodig.
 *    Dit verving het scrapen van "hoogste vrij opneembare spaarrente": dat
 *    leverde commerciële actietarieven op (Revolut e.d.) die vooral iets
 *    zeggen over wie er op dat moment klanten wil werven, niet over de
 *    renteontwikkeling. De depositorente is wat banken krijgen als ze geld
 *    bij de ECB stallen en is daarmee de onderliggende drijver van álle
 *    consumentenspaarrentes — die volgen 'm met vertraging.
 *    Extra winst: de API levert de volledige geschiedenis, dus de trendlijn
 *    is meteen echt i.p.v. dat hij zich maandenlang moet opbouwen.
 *
 * 2. Hypotheekrente — best-effort scraper op actuelerentestanden.nl
 *    (robots.txt staat scrapen van deze publieke pagina's toe). ABN AMRO-
 *    specifieke pagina, 10 jaar vast met NHG, product "Woning Hypotheek"
 *    (hun standaard; er is ook een goedkopere "Budget"-variant, maar Woning
 *    is representatiever voor "de rente van ABN AMRO"). Regex i.p.v. een
 *    HTML-parser-dependency: de tabel heeft stabiele class-namen en levert
 *    de rente in een data-order-attribuut. Hiervoor bestaat géén gratis
 *    historische API, dus die trend bouwt zich wél dagelijks op via de
 *    rate_history-tabel — de eerste dagen dus nog geen lijn.
 *
 * Bij een fout blijft de laatst bekende waarde staan en schuift okAt niet
 * mee, zodat de UI kan tonen dat de data verouderd is. Nooit crashen.
 * Ververst 1x per dag: beide bewegen traag (de ECB beslist ~8x per jaar).
 */

const { db } = require('./db');

/* Depositofaciliteit (DFR), dagreeks. De reeks herhaalt dezelfde stand elke
   dag tot de ECB 'm wijzigt, dus de overgangen zijn de interessante punten. */
const ECB_URL =
  'https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV' +
  '?format=jsondata&startPeriod=';
const MORTGAGE_URL = 'https://www.actuelerentestanden.nl/hypotheek/rente/abn-amro';
const REFRESH_MS = 24 * 60 * 60 * 1000; // 1x per dag
const FETCH_TIMEOUT_MS = 15000;
const HISTORY_DAYS = 180;       // hypotheek: eigen opgebouwde geschiedenis
const ECB_HISTORY_DAYS = 730;   // 2 jaar ECB-historie voor de trendlijn
const ECB_SPARK_POINTS = 90;    // genoeg resolutie om de stappen te zien

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; JanApp/1.0; personal-dashboard)' };

/* Per bron een eigen fout + "laatst gelukt"-tijd: de twee bronnen zijn
   onafhankelijk, dus als alleen de hypotheekpagina breekt moet de ECB-kaart
   niet meegemarkeerd worden. okAt is expliciet de laatste geslaagde ophaal
   (ts is slechts de laatste póging) — daarmee kan de UI verouderde data
   herkennen, ook als er nooit een harde fout optrad. */
let cache = {
  ecb: null,
  mortgage: null,
  ecbError: null,
  mortgageError: null,
  ecbOkAt: 0,
  mortgageOkAt: 0,
  ts: 0,
};

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

/* ---------- ECB-depositorente (officiële API) ---------- */
// Reeks van ~730 dagen terugbrengen tot een handvol punten voor de sparkline,
// met behoud van de tijdsverhouding — zo blijven de plateaus en de stapjes
// zichtbaar zoals ze werkelijk vielen.
function downsample(values, target) {
  if (values.length <= target) return values;
  const step = (values.length - 1) / (target - 1);
  const out = [];
  for (let i = 0; i < target; i++) out.push(values[Math.round(i * step)]);
  return out;
}

async function fetchEcb() {
  const from = new Date(Date.now() - ECB_HISTORY_DAYS * 864e5).toISOString().slice(0, 10);
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let json;
  try {
    const r = await fetch(ECB_URL + from, {
      signal: ctrl.signal,
      headers: { ...UA, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    json = await r.json();
  } finally {
    clearTimeout(timeout);
  }

  // SDMX-JSON: observaties zijn geïndexeerd, de bijbehorende datums staan in
  // een aparte dimensie-lijst. Defensief uitpakken — bij een formaatwijziging
  // liever een nette fout dan een half gevulde kaart.
  const timeDim = json?.structure?.dimensions?.observation?.find((d) => d.id === 'TIME_PERIOD');
  const series = json?.dataSets?.[0]?.series;
  const firstSeries = series && Object.values(series)[0];
  if (!timeDim || !firstSeries?.observations) throw new Error('onverwacht antwoordformaat');

  const times = timeDim.values.map((v) => v.id);
  const points = Object.keys(firstSeries.observations)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => ({ date: times[i], rate: firstSeries.observations[String(i)][0] }))
    .filter((p) => p.date && Number.isFinite(p.rate));
  if (points.length < 2) throw new Error('te weinig observaties');

  // Overgangen isoleren. Let op: het eerste punt is het begin van ons venster,
  // geen echte wijziging — pas vanaf de tweede weten we zeker dát er iets
  // veranderde en van welke stand naar welke.
  const changes = [];
  let prev = null;
  for (const p of points) {
    if (prev === null || p.rate !== prev) changes.push(p);
    prev = p.rate;
  }
  const last = changes.length > 1 ? changes[changes.length - 1] : null;
  const before = changes.length > 1 ? changes[changes.length - 2] : null;

  return {
    rate: points[points.length - 1].rate,
    // null = geen enkele wijziging binnen het venster; dan geen "sinds"-tekst
    // verzinnen die we niet kunnen onderbouwen.
    since: last ? last.date : null,
    change: last && before ? Number((last.rate - before.rate).toFixed(2)) : null,
    previous: before ? before.rate : null,
    spark: downsample(points.map((p) => p.rate), ECB_SPARK_POINTS),
  };
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
  let ecb = null;
  let mortgage = null;
  let ecbError = null;
  let mortgageError = null;

  try {
    ecb = await fetchEcb();
  } catch (err) {
    ecbError = String(err.message || err);
  }
  try {
    mortgage = parseMortgage(await fetchHtml(MORTGAGE_URL));
    // Een lege parse is géén succes: de pagina laadde (HTTP 200), maar de
    // tabel is niet meer te vinden. Zonder deze check bleef de oude waarde
    // stil staan en merkte je nooit dat de scraper stuk was.
    if (!mortgage) throw new Error('hypotheektabel niet gevonden — site-structuur gewijzigd?');
  } catch (err) {
    mortgageError = String(err.message || err);
  }

  // Alleen de hypotheek heeft eigen geschiedenisopbouw nodig; de ECB-reeks
  // komt al mét historie uit de API.
  if (mortgage) upsertHistory.run('mortgage_abn_10y', today, mortgage.rate);

  const now = Date.now();
  // Eén van de twee kan missen zonder de andere te verliezen: bij een fout
  // blijft de laatst bekende waarde staan, maar okAt schuift niet mee — zo
  // ziet de UI hoe oud die waarde inmiddels is.
  cache = {
    ecb: ecb || cache.ecb,
    mortgage: mortgage || cache.mortgage,
    ecbError,
    mortgageError,
    ecbOkAt: ecb ? now : cache.ecbOkAt,
    mortgageOkAt: mortgage ? now : cache.mortgageOkAt,
    ts: now,
  };
  if (ecbError) console.error('[rates] ECB:', ecbError);
  if (mortgageError) console.error('[rates] hypotheekrente:', mortgageError);
  if (broadcast) broadcast('rates:update', { generated_at: now });
}

function snapshot() {
  return {
    // De ECB-spark komt uit de API zelf, niet uit rate_history.
    ecb: cache.ecb ? { ...cache.ecb, ok_at: cache.ecbOkAt || null } : null,
    mortgage: cache.mortgage
      ? { ...cache.mortgage, spark: historySpark('mortgage_abn_10y'), ok_at: cache.mortgageOkAt || null }
      : null,
    ecb_error: cache.ecbError,
    mortgage_error: cache.mortgageError,
    updated_at: cache.ts || null,
    // Gecombineerd, voor logging/algemene meldingen.
    error:
      [
        cache.ecbError && `ECB: ${cache.ecbError}`,
        cache.mortgageError && `hypotheekrente: ${cache.mortgageError}`,
      ]
        .filter(Boolean)
        .join('; ') || null,
    sources: { ecb: 'data-api.ecb.europa.eu', mortgage: 'actuelerentestanden.nl' },
  };
}

function start(broadcast) {
  refresh(broadcast).catch((e) => console.error('[rates] eerste refresh faalde:', e.message));
  setInterval(() => {
    refresh(broadcast).catch((e) => console.error('[rates] refresh faalde:', e.message));
  }, REFRESH_MS);
}

module.exports = { start, snapshot, refresh };
