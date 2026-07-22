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
 * 2. Hypotheekrente — óók de ECB, maar de MIR-statistiek (MFI-rentes): het
 *    NL-gemiddelde op nieuwe woninghypotheken met rentevastperiode >5 en
 *    ≤10 jaar. Dit verving een scrape van één bank (ABN AMRO): dat was een
 *    geadverteerd tarief, geen gemiddelde, én fragiel. MIR is een officieel,
 *    volume-gewogen gemiddelde over alle geldverstrekkers, mét eigen historie
 *    (dus geen zelf-opgebouwde rate_history meer nodig).
 *
 * Bij een fout blijft de laatst bekende waarde staan en schuift okAt niet
 * mee, zodat de UI kan tonen dat de data verouderd is. Nooit crashen.
 * Ververst 1x per dag: beide bewegen traag (MIR is bovendien maandelijks).
 */

/* Depositofaciliteit (DFR), dagreeks. De reeks herhaalt dezelfde stand elke
   dag tot de ECB 'm wijzigt, dus de overgangen zijn de interessante punten. */
const ECB_URL =
  'https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV' +
  '?format=jsondata&startPeriod=';
// Hypotheek: officiële MIR-statistiek (ECB/DNB) — NL gemiddelde rente op
// nieuwe woninghypotheken met rentevastperiode >5 en ≤10 jaar (de bucket die
// het dichtst bij "10 jaar vast" ligt; MIR kent geen exact-10-jaar-bucket).
// Dit is een volume-gewogen gemiddelde over álle geldverstrekkers — het echte
// "gemiddelde", niet één bank of een geadverteerd NHG-tarief. Maandelijks,
// ~6 weken lag. Vanaf jan 2026 op verzoek.
const MORTGAGE_URL =
  'https://data-api.ecb.europa.eu/service/data/MIR/M.NL.B.A2C.P.R.A.2250.EUR.N' +
  '?format=jsondata&startPeriod=2026-01';
const REFRESH_MS = 24 * 60 * 60 * 1000; // 1x per dag
const FETCH_TIMEOUT_MS = 15000;
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

/* ---------- ECB SDMX-helpers (gedeeld door depositorente + hypotheek) ---------- */
// Reeks terugbrengen tot een handvol punten voor de sparkline, met behoud van
// de tijdsverhouding — zo blijven plateaus en stapjes zichtbaar zoals ze
// werkelijk vielen.
function downsample(values, target) {
  if (values.length <= target) return values;
  const step = (values.length - 1) / (target - 1);
  const out = [];
  for (let i = 0; i < target; i++) out.push(values[Math.round(i * step)]);
  return out;
}

// Haalt een SDMX-JSON-reeks op en levert de observaties als {date, rate},
// oud->nieuw. Defensief uitpakken — bij een formaatwijziging liever een nette
// fout dan een half gevulde kaart.
async function fetchSdmxPoints(url) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let json;
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { ...UA, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    json = await r.json();
  } finally {
    clearTimeout(timeout);
  }
  const timeDim = json?.structure?.dimensions?.observation?.find((d) => d.id === 'TIME_PERIOD');
  const series = json?.dataSets?.[0]?.series;
  const firstSeries = series && Object.values(series)[0];
  if (!timeDim || !firstSeries?.observations) throw new Error('onverwacht antwoordformaat');
  const times = timeDim.values.map((v) => v.id);
  return Object.keys(firstSeries.observations)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => ({ date: times[i], rate: firstSeries.observations[String(i)][0] }))
    .filter((p) => p.date && Number.isFinite(p.rate));
}

/* ---------- ECB-depositorente ---------- */
async function fetchEcb() {
  const from = new Date(Date.now() - ECB_HISTORY_DAYS * 864e5).toISOString().slice(0, 10);
  const points = await fetchSdmxPoints(ECB_URL + from);
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

/* ---------- Hypotheekrente: NL-gemiddelde (ECB MIR) ---------- */
// Maandreeks vanaf jan 2026. In tegenstelling tot de depositorente is dit geen
// stapfunctie maar een doorlopend gemiddelde, dus de hele reeks is de spark;
// geen "sinds"-detectie nodig.
async function fetchEcbMortgage() {
  const points = await fetchSdmxPoints(MORTGAGE_URL);
  if (!points.length) throw new Error('geen observaties');
  return {
    rate: points[points.length - 1].rate,
    first_date: points[0].date,     // "2026-01" — voor het periode-label
    last_date: points[points.length - 1].date,
    spark: points.map((p) => p.rate),
  };
}

async function refresh(broadcast) {
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
    mortgage = await fetchEcbMortgage();
  } catch (err) {
    mortgageError = String(err.message || err);
  }

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

// "2026-01" -> "sinds jan '26". Kort periode-label onder de hypotheek-spark.
const MONTHS_NL = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return null;
  return `sinds ${MONTHS_NL[+m[2] - 1]} '${m[1].slice(2)}`;
}

function snapshot() {
  return {
    // Beide sparks komen uit de ECB-API zelf. Depositorente: 2-jaars venster.
    ecb: cache.ecb
      ? { ...cache.ecb, spark_period: '2 jaar', ok_at: cache.ecbOkAt || null }
      : null,
    // Hypotheek: maandreeks vanaf jan 2026.
    mortgage: cache.mortgage
      ? {
        ...cache.mortgage,
        spark_period: monthLabel(cache.mortgage.first_date),
        ok_at: cache.mortgageOkAt || null,
      }
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
    sources: { ecb: 'data-api.ecb.europa.eu', mortgage: 'data-api.ecb.europa.eu (MIR)' },
  };
}

function start(broadcast) {
  refresh(broadcast).catch((e) => console.error('[rates] eerste refresh faalde:', e.message));
  setInterval(() => {
    refresh(broadcast).catch((e) => console.error('[rates] refresh faalde:', e.message));
  }, REFRESH_MS);
}

module.exports = { start, snapshot, refresh };
