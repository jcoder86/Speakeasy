# JanApp — Renovatieplan Speakeasy

## Doel
Speakeasy (chatportal + to-do) wordt JanApp: een persoonlijke go-to pagina op desktop (browser-startpagina) én telefoon (PWA), met drie onderdelen:

1. **To-do** — geprofessionaliseerd: labels/tags, filteren, sync tussen devices (bestaat al via server-db).
2. **Newsfeed** — koersen van watchlist-aandelen + twee nieuwscategorieën: (a) nieuws gerelateerd aan de watchlist, (b) macro-economie/AI/globaal relevant, gecureerd via de eerder ontworpen rubric-pipeline.
3. **Chat** — behouden, maar secundair (eigen tab, niet het podium).

## Genomen beslissingen
- **Platform:** responsive PWA. Eén codebase, installeerbaar op telefoon, startpagina op desktop. Vereist HTTPS.
- **Stack blijft:** Node/Express + vanilla JS, geen framework, geen build-step, `node:sqlite`, SSE. Bewezen en past bij de repo.
- **Data:** hybride. Koersen live via Finnhub (server-side proxy, key in env). Watchlist-nieuws live via Finnhub company-news. Macro/AI-nieuws via aparte GitHub Actions-pipeline met Claude-scoring (rubric uit JanApp-project), die een `feed.json` publiceert. Bronnen voorlopig zonder Reddit (HN, dev.to, GitHub Search API, RSS) — Reddit's API vereist een goedkeuringsaanvraag die nog loopt; zie `docs/PROMPT_PIPELINE.md` voor hoe die later toegevoegd wordt.
- **Hosting:** bestaande Dokploy-setup (Traefik verzorgt HTTPS). Geen Caddy, geen wijzigingen aan de proxy-laag.
- **Watchlist:** configureerbaar in de app zelf (geen hardcoded tickers).
- **Geen auth:** bewuste keuze — noindex/nofollow + robots.txt, link wordt nergens gedeeld.

## Architectuur
```
[Telefoon PWA]  [Desktop browser]
        \          /
      HTTPS (Traefik/Dokploy, bestaande VPS)
            |
   JanApp (Express + SQLite)
     |            |
  Finnhub      feed.json  <- GitHub Actions pipeline (janapp-feed repo,
 (koersen +    (GitHub       dagelijkse cron, Haiku-scoring + Sonnet-
  ticker-news)  Pages/raw)   samenvatting volgens rubric)
```

## Datamodel-uitbreidingen (additief, idempotent)
- `labels` (id, name, color)
- `todo_labels` (todo_id, label_id)
- `watchlist` (id, ticker, display_name, added_at)
- `prices` (ticker, date, close) — dagelijkse snapshot-cache voor multi-day deltas (fallback als Finnhub-candles niet in free tier zitten)

## UX
- **Mobiel (<1024px):** bottom-tab-navigatie: Feed | To-do | Chat.
- **Desktop (≥1024px):** dashboard-grid: links feed-kolom (koersen-strip bovenaan, daaronder nieuws in twee secties), rechts to-do-paneel. Chat via tab.
- Koerskaart per ticker: prijs, 1d/5d/21d/63d/YTD-delta, kleurcodering.
- Nieuwsitem: titel, NL-samenvatting, bron, score-decay conform rubric (final_score ≥ 4 zichtbaar).

## Fasering
| Fase | Inhoud | Resultaat |
|---|---|---|
| 0 | Rebrand + noindex + PWA-shell + responsive navigatie | Installeerbare JanApp met bestaande features |
| 1 | To-do pro: labels, filteren, UI-verbetering lange lijsten | Professionele to-do |
| 2 | Watchlist + koersen (Finnhub-proxy, deltas, cache) | Live koersenblok |
| 3a | Watchlist-nieuws (Finnhub company-news) | Nieuws per aandeel |
| 3b | Pipeline-repo `janapp-feed` bouwen (aparte prompt, zonder Reddit voorlopig) | Dagelijkse gecureerde macro/AI-feed |
| 4 | Deploy via bestaande Dokploy: env vars, DEPLOY.md | Live, startpagina + telefoon-icoon |

## Kosten
VPS + Dokploy draaien al. Nieuw: Claude API pipeline ~€1-2/mnd, Finnhub gratis.

## Prompts
- `docs/PROMPT_APP.md` — Claude Code-prompt voor de app-renovatie (fase 0-3a, 4)
- `docs/PROMPT_PIPELINE.md` — Claude Code-prompt voor de nieuws-pipeline (fase 3b)
