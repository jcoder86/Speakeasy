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
| 5 *(retroactief, elders gebouwd)* | Koersen van Finnhub naar Twelve Data (US) + EODHD (Euronext/Warschau) + MOEX (Moskou); échte dagcandles i.p.v. opsparen, compacte koerstabel, sparklines, EUR/RUB-omrekening | Koersentabel + sparklines zoals nu live op chat.genapps.nl |

## Kosten
VPS + Dokploy draaien al. Claude API pipeline ~€1-2/mnd, Twelve Data/EODHD/Finnhub gratis tiers.

## Prompts
- `docs/PROMPT_APP.md` — Claude Code-prompt voor de app-renovatie (fase 0-3a, 4)
- `docs/PROMPT_PIPELINE.md` — Claude Code-prompt voor de nieuws-pipeline (fase 3b)

---

# Redesign naar dashboard-vorm (fase 6+)

Aanleiding: een to-be screenshot van een sidebar-dashboard (Home/Portfolio/Aandelen/
Marktnieuws/Agenda/To-do's/Watchlist/Tools/Instellingen) met KPI-kaarten bovenaan
(Portfolio, Sparrente, Hypotheekrente, Agenda, Open to-do's, Fear & Greed) en een
3-koloms hoofdscherm. Dit is een fundamentele redesign, geen kleine uitbreiding:
nieuwe navigatie-vorm, nieuwe databronnen, nieuwe concepten (portfolio-holdings,
agenda) naast wat er al staat.

## Beslissingen (met jou afgestemd)
- **Portfolio = échte holdings.** Nieuwe tabel met aandeel + aantal + aankoopprijs +
  aankoopdatum. De KPI-kaart toont een kloppend rendement (huidige waarde t.o.v.
  inleg), geen afgeleide van de watchlist.
- **Agenda = Google Calendar-sync.** Niet een eigen simpel events-tabelletje, maar
  een echte OAuth-koppeling met je bestaande Google-agenda. Grootste losse
  bouwblok van de hele redesign (zie fase 11).
- **Sparrente / Hypotheekrente / Fear & Greed: best-effort scrapen.** Geen
  officiële gratis API's beschikbaar voor deze drie. Aanpak per kaart:
  - **Fear & Greed**: CNN's interne JSON-endpoint (onofficieel maar breed gebruikt
    en stabieler dan HTML-scrapen, want het is al gestructureerde data).
  - **Sparrente/Hypotheekrente NL**: moet HTML-scrapen van een specifieke bron —
    **welke bron/rentevorm precies staat nog open** (welke bank of gemiddelde;
    hypotheek 10 jaar vast met/zonder NHG?). Ik stel in fase 12 een concreet
    voorstel met een default, jij corrigeert waar nodig. Scrapers zijn inherent
    fragiel (breken bij site-herontwerp) — geen garantie op lange-termijn-stabiliteit.
- **Biggest movers: breder dan de watchlist, maar geen hele markt.** Exacte
  samenstelling van dat bredere kader staat nog open — voorstel volgt in fase 10
  (een los te onderhouden "movers-universe"-lijst, apart van de watchlist, één keer
  per dag ververst i.v.m. gratis rate-limits — elke 15 minuten zou bij een grotere
  lijst de gratis Twelve Data-credits opsouperen).

## Fasering (vervolg)
| Fase | Inhoud | Openstaand? |
|---|---|---|
| 6 | **Dashboard-shell**: sidebar-navigatie i.p.v. bottom-tabs/2-tab-header, dark mode (CSS-vars + toggle, onthouden per device), "Markten open"-status + "data bijgewerkt Xm geleden". Puur layout — bestaande features (aandelentabel, nieuws, to-do's, chat) verhuizen naar eigen pagina's zonder functionele wijziging. | — |
| 7 | **Home-dashboard-compositie**: KPI-kaartenrij + 3-koloms indeling (aandelen+movers / marktnieuws+AI&Tech / to-do's-paneel) zoals de screenshot, met de databronnen die er al zijn. Kaarten waarvan de databron nog niet bestaat (Portfolio, Sparrente, Hypotheekrente, Fear&Greed, Agenda) tonen een nette placeholder tot hun eigen fase. | — |
| 8 | ~~To-do vervaldatum~~ | **Geskipt op jouw verzoek** — je werkt niet met to-do-deadlines. Home-to-do-paneel toont daarom een simpele open-lijst, geen Vandaag/Later-splitsing. |
| 9 | **Portfolio (holdings)**: tabel `holdings` (ticker, aantal, aankoopprijs, aankoopdatum), CRUD-UI, P&L tegen actuele koers (hergebruikt quotes.js), Portfolio-pagina + Home-KPI-kaart met 3M-grafiek. | — |
| 10 | **Marktnieuws (algemeen) + Biggest movers**: Finnhub general-market-news endpoint (bestaande key, geen nieuwe) voor de brede Marktnieuws-tab met Highlights/Alle nieuws + filter; Biggest movers over een apart, curated "movers-universe" (dagelijks ververst). | **Ja** — samenstelling movers-universe met jou afstemmen voor de bouw. |
| 11 | **Agenda via Google Calendar** — **uitgesteld**, komt later. | Jouw eenmalige Google Cloud-setup nodig voordat ik kan bouwen. |
| 12 | **Sparrente / Hypotheekrente / Fear & Greed-kaarten**: Fear&Greed via CNN-JSON; Sparrente/Hypotheekrente-scraper met een voorgesteld default (bron + rentevorm) ter goedkeuring. | **Ja** — bron/rentevorm afstemmen voor de bouw. |
| 13 *(optioneel, laatste)* | Command-palette (⌘K), invulling "Tools"-pagina (nog te bepalen wat hierin komt). | **Ja** — scope van Tools nog leeg in de screenshot. |

Zelfde discipline als eerder: elke fase los werkend, eigen commit, ik wacht op
jouw akkoord voordat ik aan de volgende begin. Gegeven de omvang (8 fases) stel ik
voor de volgorde hierboven aan te houden — schreeuw als je liever herprioriteert
(bv. Portfolio vóór de shell-redesign, of Agenda/Google-OAuth juist naar het einde).

## Paginastructuur fase 6+7 (concreet)
Sidebar (desktop) / bottom-nav + "Meer"-overflow (mobiel):
- **Home** — dashboardcompositie (fase 7): KPI-kaartenrij (Portfolio/Sparrente/
  Hypotheekrente/Agenda/Fear&Greed als placeholder, Open to-do's echt) + 3 kolommen
  (Mijn aandelen-excerpt + Movers-binnen-watchlist / Marktnieuws-excerpt +
  AI&Tech-excerpt / To-do's-paneel zonder Vandaag-Later).
- **Aandelen** — de volledige koerstabel + sparklines (verplaatst, ongewijzigd).
- **Marktnieuws** — beide nieuwssecties (watchlist-nieuws + AI&Tech-pipeline),
  volledige lijsten (verplaatst, ongewijzigd). Algemeen marktnieuws + Highlights-
  /filtertabs volgen in fase 10.
- **Watchlist** — ticker toevoegen/verwijderen (verplaatst uit de `<details>`,
  nu een eigen pagina).
- **To-do's** — ongewijzigd, nu ook via sidebar/desktop bereikbaar i.p.v. alleen tab.
- **Chat** — ongewijzigd.
- **Instellingen** — labels beheren (verplaatst uit de to-do filterbalk).
- **Portfolio, Agenda, Tools** — placeholder-pagina's ("komt in een latere fase"),
  zodat de navigatiestructuur al compleet is.

Dark mode: CSS-variabelen-set licht/donker, volgt systeeminstelling by default,
override + onthouden via toggle onderin de sidebar. Markt-status + "data
bijgewerkt Xm geleden" ernaast, afgeleid van de bestaande `quotes.js`-snapshot.
