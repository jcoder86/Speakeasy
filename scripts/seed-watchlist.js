'use strict';

/**
 * Vult de watchlist in één keer met de vaste lijst.
 *
 * Idempotent: bestaande tickers worden overgeslagen (UNIQUE op ticker), dus je
 * kunt dit gerust twee keer draaien. Bestaande rijen worden niet aangeraakt.
 *
 * Let op de suffixen — die bepalen in quotes.js welke bron gebruikt wordt:
 *   kaal    -> Twelve Data (US)      .AS/.WA -> EODHD      .ME -> MOEX
 *
 * Draaien (PowerShell, in de map Speakeasy):
 *   npm run seed
 * Met een oude ticker-zonder-suffix opruimen (bv. kaal ASML uit de Finnhub-tijd):
 *   npm run seed -- --replace
 */

const { db } = require('../db');

const TICKERS = [
  // --- Indices & ETF's (US) ---
  ['DIA', 'Dow Jones (DIA)'],
  ['NDAQ', 'Nasdaq, Inc.'],
  ['QQQ', 'Invesco QQQ'],
  ['VGT', 'Vanguard Info Tech'],

  // --- Nederland (Euronext Amsterdam) ---
  ['ABN.AS', 'ABN AMRO Bank'],
  ['BFIT.AS', 'Basic-Fit'],
  ['FLOW.AS', 'Flow Traders'],
  ['ASML.AS', 'ASML Holding'],

  // --- Warschau ---
  ['CDR.WA', 'CD Projekt'],

  // --- Moskou ---
  ['OZON.ME', 'Ozon Holdings'],

  // --- Overig (US) ---
  ['AI', 'C3.ai'],
  ['CEG', 'Constellation Energy'],
  ['CRDO', 'Credo Technology'],
  ['CWCO', 'Consolidated Water'],
  ['MPWR', 'Monolithic Power'],
  ['MSCI', 'MSCI'],
  ['MU', 'Micron Technology'],
  ['QCOM', 'QUALCOMM'],
  ['U', 'Unity Software'],
  ['UNH', 'UnitedHealth'],
  ['UPST', 'Upstart'],
  ['VST', 'Vistra'],
];

/* Kale varianten van tickers die eigenlijk een beurs-suffix horen te hebben.
   Die gingen naar Twelve Data (US-only) en faalden daar stilletjes. */
const STALE = ['ASML', 'ABN', 'BFIT', 'FLOW', 'CDR', 'OZON'];

const replace = process.argv.includes('--replace');

const existing = new Set(
  db.prepare('SELECT ticker FROM watchlist').all().map((r) => r.ticker),
);

if (replace) {
  const del = db.prepare('DELETE FROM watchlist WHERE ticker = ?');
  for (const t of STALE) {
    if (existing.has(t)) {
      del.run(t);
      existing.delete(t);
      console.log(`verwijderd (verkeerde beurs): ${t}`);
    }
  }
}

const insert = db.prepare(
  'INSERT INTO watchlist (ticker, display_name, added_at) VALUES (?, ?, ?)',
);

let added = 0;
let skipped = 0;
let now = Date.now();

for (const [ticker, name] of TICKERS) {
  if (existing.has(ticker)) {
    skipped++;
    continue;
  }
  // added_at oplopend, zodat de volgorde hierboven de weergavevolgorde wordt.
  insert.run(ticker, name, now++);
  added++;
  console.log(`toegevoegd: ${ticker.padEnd(9)} ${name}`);
}

console.log(`\nKlaar — ${added} toegevoegd, ${skipped} bestonden al.`);
if (!replace && STALE.some((t) => existing.has(t))) {
  console.log('Let op: er staan nog kale tickers zonder beurs-suffix in je watchlist.');
  console.log('Die falen bij Twelve Data (US-only). Opruimen met:  npm run seed -- --replace');
}
