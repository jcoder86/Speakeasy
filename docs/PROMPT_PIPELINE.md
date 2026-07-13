# Claude Code-prompt — Nieuws-pipeline `janapp-feed`

Voor een **nieuwe, aparte private repo**. Kopieer alles onder de streep in Claude Code in een lege map `janapp-feed`.

---

Bouw een dagelijkse nieuws-curatiepipeline die een `feed.json` publiceert voor mijn persoonlijke dashboard (JanApp). Python 3.11+, draait als GitHub Actions cron (dagelijks 06:00 Europe/Amsterdam), geen server.

## Architectuur
1. **Ophalen (code, geen LLM):** RSS/Atom + Hacker News API + Reddit via PRAW. Dedupliceren op url (state in `state/seen.json`, gecommit door de action), leeftijdsfilter 48u (continue modus), engagement-drempels per platform (zie onder).
2. **Scoring-cascade:** kandidaten eerst door **Claude Haiku 4.5** voor relevantie-scoring per rubric (goedkoop, batch van items per call). Items boven drempel daarna door **Claude Sonnet** voor NL-samenvatting volgens format. API-key via GitHub Secret `ANTHROPIC_API_KEY`.
3. **Publiceren:** schrijf `feed.json` naar de repo (of GitHub Pages-branch). Bestaande items behouden met decay; items onder feed-drempel verwijderen.

## Categorieën
- `macro` — macro-economie en geopolitiek met beursimpact, globaal relevant.
- `ai_usecase` — AI use-cases voor een individuele bouwer (Python+API-niveau, Claude als pair-programmer).

## Rubric (voor `ai_usecase`; kern van de curatie)
Score per item: Lifehack 0-2, ROI 0-3 (verhouding opbrengst/inspanning), Disruptief 0-2, Nuttig 0-2, Praktisch 0-2, velocity-bonus 0-1 (top-10 op platform in 24u). Opname-drempel: totaal ≥ 6 én ROI ≥ 1. `final_score = score − 0.1 × age_in_days`; feed-drempel `final_score ≥ 4`.

Hard uitsluiten vóór scoring: industrie-nieuws/modellanceringen/M&A, "10 ways AI will X"-takes, lijst-artikelen zonder bouwer-perspectief, verkooppraatjes vermomd als verhaal, pure curiosa, onhaalbaar voor een individu. LinkedIn/X-items zonder concrete cijfers/demo: −1.

Voor `macro`: eigen lichtere rubric — significantie (0-3), beursimpact (0-3), actualiteit (0-2), drempel ≥ 5. Zelfde decay.

## Engagement-drempels (sanity-check)
HN 15+ punten of 5+ comments; Reddit 25+ upvotes of 10+ comments; GitHub 10+ stars/week; dev.to 15+ reacties; Indie Hackers 10+ upvotes.

## Bronnen
`sources.yaml`, configureerbaar. Startset ai_usecase: HN (Show HN), r/LocalLLaMA, r/ClaudeAI, r/selfhosted, r/homelab, Indie Hackers, dev.to, GitHub Trending, anthropic.com/news. Startset macro: FT/Reuters/Bloomberg RSS (vrij beschikbare feeds), ECB/Fed-persberichten, r/economics (hoge drempel).

## Samenvattings-format (Sonnet, NL, warm-zakelijk, geen hype)
Per item 3-5 zinnen: titel-hook, wat/hoe/de slimme vondst, "Inspirerend omdat: …" alleen indien niet evident, "Wat je nodig hebt: …" altijd concreet, inline bronlink.

## Output-schema `feed.json`
```json
{
  "generated_at": "ISO-8601",
  "items": [{
    "id": "hash", "title": "…", "summary_nl": "…", "url": "…",
    "source": "hn|reddit:sub|rss:naam", "category": "macro|ai_usecase",
    "score": 9, "final_score": 8.4, "published_at": "ISO-8601"
  }]
}
```

## Repo-structuur
```
janapp-feed/
  .github/workflows/daily.yml   (cron 06:00 NL-tijd, commit feed.json + state)
  src/ (fetch.py, filter.py, score.py, summarize.py, publish.py, main.py)
  sources.yaml
  state/seen.json
  feed.json
  requirements.txt (feedparser, praw, anthropic, pyyaml, httpx)
```

## Kwaliteitseisen
- Audit-trail: log per run wat is uitgesloten en waarom (artifact of `state/last_run_log.md`).
- Bootstrap-modus via workflow_dispatch-input (`days=90`) voor de eerste vulling.
- Kosten bewaken: prefilter agressief in code vóór elke LLM-call; verwacht budget ~€1-2/mnd.
- Secrets: `ANTHROPIC_API_KEY`, `REDDIT_CLIENT_ID/SECRET/USER_AGENT` als GitHub Secrets.
- Voeg een `README.md` toe met setup-stappen (secrets aanmaken, eerste bootstrap-run, FEED_URL voor JanApp = raw-URL van feed.json).
