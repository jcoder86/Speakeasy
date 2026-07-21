'use strict';

/**
 * Agenda-module — proxy naar een Google Calendar "geheim iCal-adres".
 *
 * Zelfde patroon als FEED_URL/RISK_URL: env CAL_URL wijst naar een privé
 * .ics-feed, die hier server-side wordt opgehaald, geparsed en als een lijst
 * komende afspraken teruggegeven. Alleen-lezen — een dashboard toont, het
 * beheert niet.
 *
 * Bewust géén iCal-library: de rest van het project is ook dependency-arm
 * (geen cheerio, alles met de hand). Dat betekent wél dat de twee lastige
 * stukken van iCalendar hier zelf zijn opgelost:
 *   1. Tijdzones — een afspraak met TZID=Europe/Amsterdam is wandkloktijd in
 *      die zone; die wordt via Intl-offsetlookup naar een absoluut moment
 *      omgezet (DST wordt zo correct meegenomen).
 *   2. Herhalingen — RRULE (wekelijkse standup, jaarlijkse verjaardag) wordt
 *      uitgevouwen tot losse voorvallen binnen een horizon, met EXDATE en
 *      RECURRENCE-ID-overrides.
 *
 * Dev zonder CAL_URL valt terug op een meegeleverde fixture, zodat het blok
 * lokaal werkt. In productie niet: daar is een ontbrekende env een echte
 * configuratiefout en hoort het blok netjes leeg te blijven.
 */

const fs = require('node:fs');
const path = require('node:path');

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — agenda's veranderen traag
const FETCH_TIMEOUT_MS = 15000;
const DEFAULT_TZ = 'Europe/Amsterdam';
const HORIZON_DAYS = 400;   // ver genoeg om ook een jaarlijkse afspraak te vangen
const MAX_UPCOMING = 25;    // ruim voor blok (3) én de Agenda-pagina
const MAX_ITER = 1200;      // harde stop tegen een RRULE zonder einde

const FIXTURE_ICS = path.join(__dirname, 'public', 'fixtures', 'agenda.sample.ics');

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

/* ---------- tijdzone ----------
 * Offset (ms) van een IANA-zone op een bepaald moment, via Intl. local = utc +
 * offset. Hiermee reken je een wandkloktijd terug naar het echte UTC-moment. */
function tzOffsetMs(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  // 'en-US' geeft soms hour '24' voor middernacht — normaliseren.
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return asUTC - utcMs;
}

function wallClockToUtc(y, mo, d, h, mi, s, tz) {
  // Eerste gok: behandel de wandklok alsof het UTC is; corrigeer met de offset
  // op dat (benaderde) moment. Eén iteratie is ruim genoeg buiten de zeldzame
  // DST-overgangsuren.
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  return guess - tzOffsetMs(guess, tz);
}

/* ---------- .ics-parsing ---------- */
// Gevouwen regels (CRLF + spatie/tab) weer aan elkaar plakken.
function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

// Tekstwaarde-escaping ongedaan maken (\, \; \n \\).
function unescapeText(v) {
  return String(v)
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

// "DTSTART;TZID=Europe/Amsterdam:20260730T140000" ->
//   { name:'DTSTART', params:{TZID:'Europe/Amsterdam'}, value:'20260730T140000' }
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segs = left.split(';');
  const name = segs[0].toUpperCase();
  const params = {};
  for (let i = 1; i < segs.length; i++) {
    const eq = segs[i].indexOf('=');
    if (eq > 0) params[segs[i].slice(0, eq).toUpperCase()] = segs[i].slice(eq + 1);
  }
  return { name, params, value };
}

// Datum/tijd uit een DTSTART/DTEND/UNTIL/EXDATE-waarde.
function parseDate(value, params) {
  const v = String(value).trim();
  const isDate = (params && params.VALUE === 'DATE') || /^\d{8}$/.test(v);
  if (isDate) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (!m) return null;
    const [, y, mo, d] = m.map(Number);
    return { allDay: true, y, mo, d, wallMs: Date.UTC(y, mo - 1, d) };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = +m[6];
  const isUTC = m[7] === 'Z';
  const tz = (params && params.TZID) || null;
  const wallMs = Date.UTC(y, mo - 1, d, h, mi, s);
  const startMs = isUTC ? wallMs : wallClockToUtc(y, mo, d, h, mi, s, tz || DEFAULT_TZ);
  // isUTC + tz worden bewaard zodat het uitvouwen van herhalingen dezelfde
  // conversie kan herhalen als voor DTSTART zelf.
  return { allDay: false, y, mo, d, h, mi, s, tz, isUTC, wallMs, startMs };
}

function parseEvents(text) {
  const lines = unfold(text).split('\n');
  const events = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case 'SUMMARY': cur.summary = unescapeText(p.value); break;
      case 'DTSTART': cur.dtstart = parseDate(p.value, p.params); break;
      case 'DTEND': cur.dtend = parseDate(p.value, p.params); break;
      case 'RRULE': cur.rrule = parseRrule(p.value); break;
      case 'UID': cur.uid = p.value.trim(); break;
      case 'STATUS': cur.status = p.value.trim().toUpperCase(); break;
      case 'RECURRENCE-ID': cur.recurrenceId = parseDate(p.value, p.params); break;
      case 'EXDATE':
        for (const part of p.value.split(',')) {
          const ex = parseDate(part, p.params);
          if (ex) cur.exdates.push(ex.wallMs);
        }
        break;
      default: break;
    }
  }
  return events;
}

function parseRrule(value) {
  const out = {};
  for (const kv of String(value).split(';')) {
    const eq = kv.indexOf('=');
    if (eq < 0) continue;
    out[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1).toUpperCase();
  }
  const r = { freq: out.FREQ, interval: Math.max(1, parseInt(out.INTERVAL, 10) || 1) };
  if (out.COUNT) r.count = parseInt(out.COUNT, 10);
  if (out.UNTIL) { const u = parseDate(out.UNTIL, {}); if (u) r.untilMs = u.wallMs; }
  if (out.BYDAY) r.byday = out.BYDAY.split(',').map((d) => d.slice(-2)); // ordinaal-prefix negeren
  return r;
}

/* ---------- herhalingen uitvouwen ---------- */
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Maakt van een wandklok-referentie + de basis-DTSTART één occurrence-object.
function makeOccurrence(base, wy, wmo, wd) {
  if (base.allDay) {
    const wallMs = Date.UTC(wy, wmo - 1, wd);
    return {
      allDay: true,
      wallMs,
      sortMs: wallMs,
      date: `${wy}-${String(wmo).padStart(2, '0')}-${String(wd).padStart(2, '0')}`,
    };
  }
  const wallMs = Date.UTC(wy, wmo - 1, wd, base.h, base.mi, base.s);
  const startMs = base.isUTC
    ? wallMs
    : wallClockToUtc(wy, wmo, wd, base.h, base.mi, base.s, base.tz || DEFAULT_TZ);
  return { allDay: false, wallMs, sortMs: startMs, startMs };
}

// Vouwt één VEVENT uit tot occurrences met sortMs in [fromMs, toMs].
function expand(ev, fromMs, toMs, overrides) {
  const base = ev.dtstart;
  if (!base) return [];
  const exset = new Set(ev.exdates);
  const push = (occ, acc) => {
    if (exset.has(occ.wallMs)) return;
    if (overrides.has(`${ev.uid}::${occ.wallMs}`)) return; // door RECURRENCE-ID vervangen
    if (occ.sortMs < fromMs || occ.sortMs > toMs) return;
    acc.push({ ...occ, summary: ev.summary || '(geen titel)' });
  };

  if (!ev.rrule || !ev.rrule.freq) {
    const acc = [];
    push(makeOccurrence(base, base.y, base.mo, base.d), acc);
    return acc;
  }

  const r = ev.rrule;
  const acc = [];
  let emitted = 0; // telt vanaf DTSTART, voor COUNT-semantiek
  const withinBounds = (wallMs) =>
    (r.count === undefined || emitted < r.count) && (r.untilMs === undefined || wallMs <= r.untilMs);

  // Startdatum als UTC-kalenderdatum om wandklok-componenten te stappen.
  const d0 = new Date(Date.UTC(base.y, base.mo - 1, base.d));

  if (r.freq === 'WEEKLY' && r.byday && r.byday.length) {
    // Dag-voor-dag tot de horizon; selecteer weekdagen uit BYDAY in de juiste
    // week-interval. Begin bij DTSTART (occurrences dáárvoor bestaan niet).
    const startWeek = Math.floor(Date.UTC(base.y, base.mo - 1, base.d) / 6048e5); // ms per week
    const cursor = new Date(d0.getTime());
    for (let i = 0; i < MAX_ITER; i++) {
      const wallMs = cursor.getTime();
      if (wallMs > toMs + 864e5) break;
      const wk = Math.floor(wallMs / 6048e5);
      const dayOk = r.byday.includes(WEEKDAYS[cursor.getUTCDay()]);
      const weekOk = ((wk - startWeek) % r.interval + r.interval) % r.interval === 0;
      if (dayOk && weekOk && wallMs >= d0.getTime()) {
        if (!withinBounds(wallMs)) break;
        emitted++;
        push(makeOccurrence(base, cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate()), acc);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return acc;
  }

  // DAILY / WEEKLY-zonder-BYDAY / MONTHLY / YEARLY: occurrence-voor-occurrence.
  const cursor = new Date(d0.getTime());
  for (let i = 0; i < MAX_ITER; i++) {
    const wallMs = Date.UTC(
      cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(),
    );
    if (wallMs > toMs + 864e5) break;
    if (!withinBounds(wallMs)) break;
    emitted++;
    push(makeOccurrence(base, cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate()), acc);
    if (r.freq === 'DAILY') cursor.setUTCDate(cursor.getUTCDate() + r.interval);
    else if (r.freq === 'WEEKLY') cursor.setUTCDate(cursor.getUTCDate() + 7 * r.interval);
    else if (r.freq === 'MONTHLY') cursor.setUTCMonth(cursor.getUTCMonth() + r.interval);
    else if (r.freq === 'YEARLY') cursor.setUTCFullYear(cursor.getUTCFullYear() + r.interval);
    else break; // onbekende FREQ: één occurrence is genoeg
  }
  return acc;
}

// Vandaag (Europe/Amsterdam) als YYYY-MM-DD, voor "is dit nog een komende dag".
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TZ }).format(new Date());
}

function build() {
  const url = process.env.CAL_URL;
  let text = null;
  let usedFixture = false;

  const load = async () => {
    if (url) return fetchText(url);
    if (isDev() && fs.existsSync(FIXTURE_ICS)) { usedFixture = true; return fs.readFileSync(FIXTURE_ICS, 'utf8'); }
    return null;
  };

  return load()
    .then((raw) => {
      if (raw === null) return { available: false, reason: 'CAL_URL niet ingesteld' };
      text = raw;

      const now = Date.now();
      const fromMs = now - 2 * 864e5; // kleine marge terug voor all-day vandaag
      const toMs = now + HORIZON_DAYS * 864e5;

      const events = parseEvents(text);

      // Eerst de RECURRENCE-ID-overrides indexeren (uid + oorspronkelijke tijd).
      const overrides = new Map();
      for (const ev of events) {
        if (ev.recurrenceId && ev.uid) overrides.set(`${ev.uid}::${ev.recurrenceId.wallMs}`, ev);
      }

      const occ = [];
      for (const ev of events) {
        if (ev.status === 'CANCELLED') continue;
        for (const o of expand(ev, fromMs, toMs, overrides)) occ.push(o);
      }

      // Alleen echt komende afspraken: all-day telt zolang de dag >= vandaag,
      // afspraken-met-tijd zolang ze nog niet begonnen zijn.
      const today = todayStr();
      const upcoming = occ
        .filter((o) => (o.allDay ? o.date >= today : o.startMs >= now))
        .sort((a, b) => a.sortMs - b.sortMs)
        .slice(0, MAX_UPCOMING)
        .map((o) => ({
          all_day: o.allDay,
          summary: o.summary,
          start_ms: o.allDay ? null : o.startMs,
          date: o.allDay ? o.date : null,
        }));

      return {
        available: true,
        source: usedFixture ? 'fixture' : 'remote',
        generated_at: now,
        events: upcoming,
      };
    })
    .catch((err) => {
      console.error('[agenda] ophalen/parsen mislukt:', err.message || err);
      return { available: false, reason: `agenda niet beschikbaar: ${String(err.message || err)}` };
    });
}

async function snapshot() {
  if (cache.data && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;
  if (inflight) return inflight;
  inflight = build()
    .then((data) => { cache = { data, ts: Date.now() }; return data; })
    .finally(() => { inflight = null; });
  return inflight;
}

module.exports = { snapshot, parseEvents, expand, wallClockToUtc };
