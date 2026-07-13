# JanApp — deploy

Draait al op **chat.genapps.nl** via **Dokploy** met Traefik als reverse
proxy (HTTPS via Let's Encrypt). Deze pagina beschrijft de handelingen
per iteratie én de eenmalige setup.

## Env-variabelen

| Naam | Waar | Nodig voor | Voorbeeld |
|---|---|---|---|
| `FINNHUB_API_KEY` | Dokploy → Environment | Koersen (fase 2) + watchlist-nieuws (fase 3a) | `abc123…` — gratis via [finnhub.io/register](https://finnhub.io/register) |
| `FEED_URL` | Dokploy → Environment | Macro/AI-feed (fase 3a) | `https://raw.githubusercontent.com/<user>/janapp-feed/main/feed.json` — zodra de pipeline (fase 3b) draait |
| `DATA_DIR` | Optioneel | Pad voor db + uploads | Docker: `/data`, lokaal: `./data` |
| `PORT` | Optioneel | Server-poort | default `3000` |

Lokaal ontwikkelen: kopieer `.env.example` naar `.env`, vul waarden in.
`.env` staat in `.gitignore`.

## Nieuwe versie deployen

Auto-deploy vanuit `main`:

```
git push origin main
```

Dokploy pikt de push op en herbouwt de container. Volume `speakeasy-data`
op `/data` blijft staan (bevat `chat.db` + `uploads/`). Berichten,
to-do's, labels, watchlist en prijshistorie overleven de update.

Handmatig triggeren: Dokploy → project **Speakeasy** → **Deployments** →
**Redeploy**.

## Eenmalige checks per env-toevoeging

1. **`FINNHUB_API_KEY` toegevoegd:**
   - Redeploy nodig zodat de nieuwe env aan het proces hangt.
   - Op `chat.genapps.nl` → tab Feed → koersen-strip toont prijzen.
   - "Mijn aandelen"-sectie vult zich zodra de eerste watchlist-ticker
     nieuws heeft (cache 15 min, max 5 items per ticker).
   - 5d/21d/63d/YTD tonen "—" totdat er historie is (accumuleert dagelijks
     via `/api/quotes`).

2. **`FEED_URL` toegevoegd:**
   - Verwijst naar het raw `feed.json` uit de `janapp-feed`-pipeline
     (fase 3b, aparte repo). Cache 15 min, items met `final_score ≥ 4`.
   - Zonder key of URL: sectie toont "Pipeline nog niet actief" — geen
     error.

## Ticker-formaat (Finnhub free tier)

- US-stocks/ETFs: gewoon de ticker (`AAPL`, `MSFT`, `QQQ`, `VGT`, `NDAQ`).
- Amsterdam: suffix `.AS` (`FLOW.AS`, `BFIT.AS`, `ABN.AS`).
- Indices: prefix `^` (`^DJI`, `^GSPC`), of gebruik de ETF-equivalent (bv.
  `DIA` voor de Dow) — die zit vaker in de free tier.
- Gedelijste / gesanctioneerde tickers (`OZON` bv.) geven een fout in de
  ticker-card; verwijder ze via het watchlist-paneeltje.

## PWA installeren

**Telefoon (Safari iOS / Chrome Android):**

1. Open `https://chat.genapps.nl`.
2. Deel-menu → **"Zet op beginscherm"** (iOS) of het `⋮`-menu →
   **"App installeren"** / **"Aan startscherm toevoegen"** (Android).
3. Icoon (blauwe "J") verschijnt tussen je apps; opent standalone zonder
   browser-chrome.

**Desktop (Chrome/Edge):**

- Klik in de adresbalk het install-icoon (rechts) → **Installeren**. Opent
  als losstaand venster.
- Of stel `chat.genapps.nl` in als browser-startpagina: Chrome →
  Instellingen → "Bij opstarten" → "Specifieke pagina('s) openen" →
  toevoegen.

## Foutenzoeken

**Koersen laden niet:**
- Check Dokploy → project → **Logs**: kom je `FINNHUB_API_KEY niet
  ingesteld` tegen? Env-variabele mist / bevat spatie.
- Finnhub kan rate-limiten (~60 req/min free); de server-cache van 60s
  vangt dat af zolang de watchlist beperkt blijft.

**PWA gebruikt oude versie:**
- Service worker cachet statics. Bij zichtbare wijzigingen wordt in
  `public/sw.js` een `CACHE_VERSION` bumped — dit zit al in de commits
  waarin styles/scripts veranderen. Als je toch stale content ziet:
  cache legen in de browser en herladen.

**Copy-to-clipboard werkt niet vanaf `http://<host>:<poort>`:**
- Clipboard API vereist HTTPS. Gebruik altijd `chat.genapps.nl`.

## Fase 3b — de nieuws-pipeline (aparte repo)

`janapp-feed` is een aparte private repo met een GitHub Actions cron die
dagelijks een `feed.json` publiceert. Zie `docs/PROMPT_PIPELINE.md`.
Daarin staan de details (bronnen, rubric-scoring via Haiku + Sonnet,
publicatie). Zodra die draait: zet zijn raw-URL in `FEED_URL` in Dokploy
en de "Macro & AI"-sectie vult zich.
