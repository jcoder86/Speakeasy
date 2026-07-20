'use strict';

/**
 * Risk-module — proxy naar de Speakeasy-risk pipeline.
 *
 * Zelfde patroon als FEED_URL: een aparte repo/workflow publiceert dagelijks
 * een risk.json (plus een append-only history.csv), die JanApp hier inleest.
 * Deze module haalt niets zelf op uit databronnen en rekent niets uit — alle
 * modellering zit in de pipeline. Hier alleen: ophalen, cachen, CSV omzetten
 * naar iets wat de UI direct kan tekenen.
 *
 * Waarom een lazy cache i.p.v. een scheduler zoals quotes/rates/movers: de
 * pipeline ververst maar 1x per dag, dus een timer die uit zichzelf blijft
 * pollen levert niets op. Eerste bezoeker na de TTL trekt 'm opnieuw.
 *
 * Dev zonder RISK_URL valt terug op een meegeleverde fixture, zodat het
 * paneel lokaal werkt (en zichtbaar blijft in de UI) zonder de pipeline.
 * In productie gebeurt dat bewust NIET: daar is een ontbrekende env een
 * echte configuratiefout en hoort de UI netjes leeg te blijven i.p.v.
 * maandenoude voorbeelddata als echt te presenteren.
 */

const fs = require('node:fs');
const path = require('node:path');

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const FETCH_TIMEOUT_MS = 15000;
// De strip is een paar honderd pixels breed; meer punten dan dit is
// onzichtbaar detail en alleen maar payload.
const HISTORY_POINTS = 400;

const FIXTURE_DIR = path.join(__dirname, 'public', 'fixtures');
const FIXTURE_JSON = path.join(FIXTURE_DIR, 'risk.sample.json');
const FIXTURE_CSV = path.join(FIXTURE_DIR, 'risk.history.sample.csv');

const isDev = () => process.env.NODE_ENV !== 'production';

let cache = { data: null, ts: 0 };
let inflight = null;

async function fetchText(url) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------- history.csv ----------
 * Verwacht formaat: date,fragility,stress. Kolomnamen worden opgezocht i.p.v.
 * op positie aangenomen, zodat een extra kolom in de pipeline dit niet breekt.
 * Lege stress-cellen komen echt voor (de stress-as begint later dan 1990),
 * die worden null — de UI tekent die lijn dan simpelweg korter.
 */
function parseHistoryCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iDate = header.findIndex((h) => h === 'date' || h === 'datum');
  const iFrag = header.findIndex((h) => h.startsWith('fragility') || h.startsWith('fragiliteit'));
  const iStress = header.findIndex((h) => h.startsWith('stress'));
  if (iDate < 0 || (iFrag < 0 && iStress < 0)) return [];

  const num = (cells, i) => {
    if (i < 0) return null;
    const v = parseFloat((cells[i] || '').trim());
    return Number.isFinite(v) ? v : null;
  };

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const d = (cells[iDate] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue; // half geschreven regel o.i.d.
    out.push({ d, f: num(cells, iFrag), s: num(cells, iStress) });
  }
  return out;
}

// Uitdunnen met behoud van eerste en laatste punt; de UI plaatst x op de
// échte datum, dus ongelijke tussenafstanden zijn geen probleem.
function downsample(points, target) {
  if (points.length <= target) return points;
  const step = (points.length - 1) / (target - 1);
  const out = [];
  for (let i = 0; i < target; i++) out.push(points[Math.round(i * step)]);
  return out;
}

async function build() {
  const url = process.env.RISK_URL;
  let risk = null;
  let usedFixture = false;

  try {
    if (url) {
      risk = JSON.parse(await fetchText(url));
    } else if (isDev() && fs.existsSync(FIXTURE_JSON)) {
      risk = JSON.parse(fs.readFileSync(FIXTURE_JSON, 'utf8'));
      usedFixture = true;
    } else {
      return { available: false, reason: 'RISK_URL niet ingesteld' };
    }
  } catch (err) {
    console.error('[risk] risk.json ophalen mislukt:', err.message || err);
    return { available: false, reason: `risk.json niet beschikbaar: ${String(err.message || err)}` };
  }

  if (!risk || typeof risk !== 'object' || !risk.regime) {
    return { available: false, reason: 'risk.json heeft een onverwacht formaat' };
  }

  /* Historie is bijzaak: zonder strip blijft de rest van het paneel bruikbaar,
     dus een mislukte CSV mag het geheel niet onbeschikbaar maken. */
  let history = [];
  let historyError = null;
  const histUrl = process.env.RISK_HISTORY_URL || risk.history_url || null;
  try {
    if (usedFixture && !process.env.RISK_HISTORY_URL && fs.existsSync(FIXTURE_CSV)) {
      history = parseHistoryCsv(fs.readFileSync(FIXTURE_CSV, 'utf8'));
    } else if (histUrl) {
      history = parseHistoryCsv(await fetchText(histUrl));
    }
  } catch (err) {
    historyError = String(err.message || err);
    console.error('[risk] history.csv ophalen mislukt:', historyError);
  }

  return {
    available: true,
    source: usedFixture ? 'fixture' : 'remote',
    generated_at: risk.generated_at || null,
    regime: risk.regime,
    regime_label_nl: risk.regime_label_nl || null,
    regime_since: risk.regime_since || null,
    fragility: risk.fragility || null,
    stress: risk.stress || null,
    drivers: Array.isArray(risk.drivers) ? risk.drivers : [],
    analogs: Array.isArray(risk.analogs) ? risk.analogs : [],
    ai_summary_nl: risk.ai_summary_nl || null,
    indicators: risk.indicators || {},
    history: downsample(history, HISTORY_POINTS),
    history_points: history.length,
    history_error: historyError,
  };
}

async function snapshot() {
  if (cache.data && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;
  // Eén gedeelde call: zonder dit haalt elke gelijktijdige bezoeker na het
  // verlopen van de TTL zijn eigen kopie op.
  if (inflight) return inflight;
  inflight = build()
    .then((data) => {
      cache = { data, ts: Date.now() };
      return data;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

module.exports = { snapshot, parseHistoryCsv, downsample };
