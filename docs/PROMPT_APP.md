# Claude Code-prompt — Renovatie Speakeasy → JanApp

Kopieer alles onder de streep in Claude Code, gestart in de root van deze repo.

---

Renoveer deze app (Speakeasy) tot **JanApp**. Lees eerst `docs/JANAPP_PLAN.md` voor context. Werk fase voor fase, commit per fase met duidelijke message, en stop na elke fase zodat ik kan reviewen.

## Harde randvoorwaarden
- Stack blijft: Node/Express + vanilla JS, **geen framework, geen build-step**, `node:sqlite` (`DatabaseSync`), SSE via het bestaande `broadcast()`-patroon.
- Bestaande data blijft intact: alle schema-wijzigingen additief en idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE` met try/catch of kolom-check). Nooit droppen.
- Bestaande conventies volgen: NL comments, foutafhandeling zoals in `server.js`, UUID-bestandsnamen, epoch-ms timestamps.
- Secrets alleen via env: `FINNHUB_API_KEY`, `FEED_URL`. Voeg `.env.example` toe; `.env` in `.gitignore`.
- **Geen auth** — bewuste keuze. Wel: `<meta name="robots" content="noindex, nofollow">` in `index.html` en een `robots.txt` met `Disallow: /`.

## Fase 0 — Rebrand, PWA-shell
1. Hernoem UI naar "JanApp" (title, header, package.json-description). Voeg noindex-meta + robots.txt toe (zie randvoorwaarden).
2. **PWA:** `manifest.json` (name JanApp, display standalone, theme-color, iconen 192/512 — genereer simpele SVG→PNG placeholder-iconen), service worker: cache-first voor statics, network-first voor `/api/*`, nooit cachen van SSE en `/api/login`.
3. **Responsive shell:** mobiel (<1024px) bottom-tab-bar met drie tabs: **Feed | To-do | Chat** (Feed default). Desktop (≥1024px) dashboard-grid: feed-kolom links (ca. 60%), to-do-paneel rechts; chat als volwaardige tab. Bestaande chat- en todo-functionaliteit blijft volledig werken. Feed-tab mag in deze fase een placeholder zijn.

## Fase 1 — To-do professionalisering
1. Schema: `labels(id, name UNIQUE, color)` en `todo_labels(todo_id, label_id)` met FK's en cascade delete.
2. API: `GET/POST/DELETE /api/labels`; `PATCH /api/todos/:id` accepteert optioneel `labels: [id,…]` (vervangt de set); `GET /api/todos` levert todos inclusief hun labels (join, één query of twee — geen N+1).
3. UI: labels als gekleurde chips op todo-items; label toekennen via edit-modus; filterbalk boven de lijst (filter op label(s) en op open/afgerond); teller per filter. Lange lijsten: afgeronde items in inklapbare sectie onderaan. SSE-events (`todo:*`, `label:*`) zodat devices synchroon blijven.

## Fase 2 — Watchlist & koersen
1. Schema: `watchlist(id, ticker UNIQUE, display_name, added_at)` en `prices(ticker, date, close, PRIMARY KEY(ticker,date))`.
2. API: `GET/POST/DELETE /api/watchlist`. `GET /api/quotes`: haalt per watchlist-ticker de Finnhub `/quote` op (server-side, in-memory cache 60s) en berekent deltas 1d/5d/21d/63d/YTD uit de `prices`-tabel. Schrijf bij elke succesvolle quote-call de dagclose weg naar `prices` (upsert). **Let op:** Finnhub `/stock/candle` zit mogelijk niet in de free tier — probeer hem éénmalig voor historie-backfill; bij 403 gewoon accumuleren via dagelijkse snapshots en deltas tonen zodra er historie is ("—" bij onvoldoende data).
3. UI: koersen-strip bovenaan de feed (horizontaal scrollbaar op mobiel): ticker, prijs, 1d-delta groot, overige deltas klein; groen/rood. Beheer van de watchlist via een instellingen-paneeltje (tandwiel): ticker toevoegen/verwijderen.

## Fase 3a — Watchlist-nieuws
1. `GET /api/news/stocks`: per watchlist-ticker Finnhub `/company-news` (laatste 7 dagen), server-side cache 15 min, gededupliceerd op url, gesorteerd op datum, max ~5 per ticker.
2. `GET /api/news/feed`: proxyt `FEED_URL` (JSON van de pipeline, zie `docs/PROMPT_PIPELINE.md`), cache 15 min. Verwacht schema: `{generated_at, items:[{id,title,summary_nl,url,source,category,score,final_score,published_at}]}`. Toon alleen items met `final_score ≥ 4`, gesorteerd op `final_score` desc. Als `FEED_URL` leeg is of faalt: sectie met nette lege-staat, geen error.
3. UI feed-kolom, onder de koersen-strip, twee secties: **"Mijn aandelen"** (company-news, gegroepeerd of getagd per ticker) en **"Macro & AI"** (pipeline-feed: titel, NL-samenvatting, bron + link, relatieve tijd).

## Fase 4 — Deploy
De app draait al via **Dokploy (Traefik doet HTTPS)** — voeg dus GEEN Caddy of andere reverse proxy toe en wijzig de poort-setup niet.
1. Zorg dat `FINNHUB_API_KEY` en `FEED_URL` als env-variabelen werken zoals Dokploy ze aanlevert (geen .env-file vereist in productie).
2. `DEPLOY.md` met korte stappen: env vars zetten in Dokploy, push naar main → rebuild, check HTTPS (vereist voor PWA), PWA installeren op telefoon ("Zet op beginscherm") en instellen als browser-startpagina op desktop.

## Definition of done per fase
Alles werkt lokaal met `npm run dev`; geen console-errors; mobiel getest via responsive mode; bestaande chat/todo-functionaliteit onaangetast; commit per fase.
