# PLAN.md — Chat-app (Speakeasy), nieuwe build

## Context & beslissingen
- Map `Speakeasy` is leeg → we bouwen **from scratch**, niet als uitbreiding.
- Beslissingen (door jou bevestigd):
  1. **Stack:** Node + vanilla JS, geen framework, geen build-step.
  2. **Bestaande data:** verse lege db. Het verleden wordt gewist → de hele
     DATA-MIGRATIE-sectie uit de opdracht **vervalt** (geen migratie, geen
     backup van een oude `chat.db`). Schema wordt meteen compleet gebouwd.
  3. **Deploy:** ik lever `Dockerfile` + `docker-compose.yml` als losse,
     laatste commit. Jij reviewt en deployt zelf. Lokaal draait alles met
     `npm run dev`.
- "RENAME" (Clip → Chat) is hiermee triviaal: er is niets om te hernoemen,
  we gebruiken "Chat" meteen overal (H1 + `<title>`).

## Tech-stack & libraries (motivatie — spec eist "geen libraries tenzij nodig")
- **express** — HTTP-server + routing. Bare `http` kan, maar express houdt
  routes/static/SSE leesbaar. Klein, geen build-step.
- **multer** (2.x) — parst `multipart/form-data` voor de image-upload. Multipart
  handmatig parsen is foutgevoelig; multer doet ook de 10MB-limiet.
- **nodemon** (devDependency) — server-herstart bij wijziging, want jij vroeg
  expliciet om `npm run dev` met hot reload.
- **SQLite** → ingebouwde `node:sqlite` (`DatabaseSync`), GÉÉN dependency.
  Oorspronkelijk plan was `better-sqlite3`, maar die compileert native en eist
  Python + build-tools (niet aanwezig). `node:sqlite` zit in Node 24, is
  synchroon, vergelijkbare API — strikt beter: één dependency minder, geen
  build-tooling. Wel een experimentele module (kan een warning printen).
- **Géén** uuid-library → ingebouwde `crypto.randomUUID()`.
- Frontend: 100% vanilla. Upload via `FormData`, real-time via `EventSource`,
  paste/copy via de native Clipboard API. Geen frontend-libraries.
- Frontend "hot reload" = browser-refresh (geen bundler). Alleen de server
  herstart automatisch via nodemon.

## Bestanden (allemaal nieuw)
```
Speakeasy/
  PLAN.md              (dit bestand)
  package.json
  .gitignore           (node_modules/, data/)
  server.js            (express-app: routes, SSE-broadcast, static serving)
  db.js                (better-sqlite3 init + schema-creatie, idempotent)
  public/
    index.html         (H1 "Chat", <title>Chat</title>, To-do-knop, input-balk)
    styles.css         (chat + to-do view, lightbox, mobiel-vriendelijk)
    app.js             (view-state, render, SSE-handlers, alle UI-logica)
  data/                (lokaal; in .gitignore)
    chat.db
    uploads/           (UUID-bestandsnamen)
  Dockerfile           (LAATSTE commit)
  docker-compose.yml   (LAATSTE commit)
```
- Data-pad via env `DATA_DIR` (default `./data`, in Docker `/data`). Uploads in
  `${DATA_DIR}/uploads`, geserveerd op route `/uploads/<bestand>`.

## Database-schema (meteen compleet — nooit een migratie nodig)
`db.js` draait `CREATE TABLE IF NOT EXISTS` bij elke start (idempotent).

**Tabel `messages`**
| kolom       | type    | opmerking                                  |
|-------------|---------|--------------------------------------------|
| id          | INTEGER | PK AUTOINCREMENT                           |
| type        | TEXT    | `'text'` of `'image'` (NOT NULL)           |
| content     | TEXT    | tekst van bericht; NULL bij image          |
| image_path  | TEXT    | UUID-bestandsnaam; NULL bij text           |
| image_mime  | TEXT    | bv. `image/png`                            |
| image_size  | INTEGER | bytes                                      |
| created_at  | INTEGER | epoch-ms, NOT NULL                         |
| edited_at   | INTEGER | NULL tot bewerkt                           |

**Tabel `todos`**
| kolom        | type    | opmerking                                 |
|--------------|---------|-------------------------------------------|
| id           | INTEGER | PK AUTOINCREMENT                          |
| text         | TEXT    | NOT NULL                                  |
| done         | INTEGER | 0/1, default 0                            |
| created_at   | INTEGER | epoch-ms, NOT NULL                        |
| edited_at    | INTEGER | NULL tot tekst bewerkt                    |
| completed_at | INTEGER | gezet bij afvinken, NULL bij weer uitvinken |

- Edit van een to-do raakt **alleen** `text` + `edited_at` — niet `done`,
  niet `completed_at` (conform spec).
- Een bericht is tekst **OF** image, afgedwongen via `type`.

## Sorteervolgorde (motivatie gevraagd in spec)
- **Chat:** nieuwste **onder** — standaard chat-conventie, auto-scroll naar
  onderkant.
- **To-do:** nieuwste **boven** — een net toegevoegd item is direct zichtbaar
  zonder te scrollen. Afgevinkte items blijven op hun plek staan (geen
  herordening bij afvinken) → voorspelbaar, simpel; ze krijgen line-through.

## API-endpoints
- `GET  /api/messages`            — alle berichten
- `POST /api/messages`            — nieuw tekstbericht `{content}`
- `POST /api/messages/image`      — multipart upload (multer)
- `PATCH /api/messages/:id`       — bewerk `content` (alleen text-berichten)
- `DELETE /api/messages/:id`      — hard delete (+ image-bestand van disk)
- `GET  /api/todos`               — alle to-do's
- `POST /api/todos`               — nieuw `{text}`
- `PATCH /api/todos/:id`          — body `{text}` = tekst bewerken,
                                     of `{done}` = afvinken/uitvinken
- `DELETE /api/todos/:id`         — hard delete
- `GET  /events`                  — SSE-stream
- `GET  /uploads/:file`           — image-bestanden

**Image-validatie (server-side):** multer `limits.fileSize = 10MB` → bij groter
HTTP 413 + nette JSON-foutmelding (frontend toont melding). Toegestaan:
png, jpg, jpeg, gif, webp — gecontroleerd op mimetype én extensie. Bestandsnaam
= `crypto.randomUUID()` + originele extensie.

## SSE-events (real-time naar alle devices)
Server houdt lijst van open `/events`-connecties bij; broadcast bij elke mutatie:
- `message:new`, `message:edit`, `message:delete`
- `todo:new`, `todo:edit`, `todo:toggle`, `todo:delete`
Delete-events bevatten alleen `id` → andere clients verwijderen het item.
Edit/toggle-events bevatten het volledige item → clients updaten inhoud +
tonen "(bewerkt)" waar `edited_at` gezet is.

## Belangrijke UI-keuzes
- **H1 "Chat"** + `<title>Chat</title>`. To-do-knop staat altijd bovenaan;
  in de to-do view is dezelfde knop een terug-knop "← Chat". De to-do view
  **vervangt** de chat-view volledig (geen modal/split) — werkt zo identiek op
  mobiel en desktop.
- **Knoppen per item:**
  - Tekstbericht: edit + delete.
  - Image-bericht: copy + delete (geen edit — er is geen tekst om te bewerken).
  - To-do: checkbox + edit + delete.
- **Edit** = inline `<textarea>` ter plekke met save/cancel. Bewerkt item krijgt
  klein "(bewerkt)" label achter de timestamp.
- **Delete** = direct weg, geen confirm-dialog, hard delete.
- **Input-balk:** textarea + "Send" + kleinere "Add to-do" + upload-knop.
  - Send / Cmd-Ctrl+Enter → tekstbericht naar chat.
  - "Add to-do" → tekst wordt nieuw to-do item, textarea leeg, blijft in
    chat-view (geen shortcut, geen view-switch).
  - Paste (Cmd/Ctrl+V) met afbeelding in clipboard → upload als image-bericht
    (`preventDefault`, niet als base64-tekst).
- **Image-weergave:** klikbare thumbnail → lightbox-overlay met full-size.
  Copy-knop gebruikt `navigator.clipboard.write([new ClipboardItem(...)])` met
  een Blob.
  - *Caveat:* browsers ondersteunen betrouwbaar alleen `image/png` op het
    klembord. Voor jpg/gif/webp converteer ik client-side naar PNG via een
    offscreen `<canvas>` vóór het kopiëren (bij GIF gaat animatie verloren —
    het wordt één frame). Wordt zo gebouwd; meld het als je het anders wilt.
- **Mobiel:** tap targets ≥44px; input-balk-knoppen met `flex-wrap` zodat ze
  niet over elkaar vallen op smalle schermen.

## Bouwvolgorde — één feature per commit
0. `git init` + scaffold: `package.json`, `.gitignore`, lege mapstructuur.
1. **Basis-chat:** server + db + `messages`-tabel, tekst versturen + lijst +
   SSE. H1 "Chat" + tab-titel. `npm run dev` werkt. → commit
2. **Edit & delete chat-berichten:** PATCH/DELETE, inline edit, "(bewerkt)"-
   label, SSE `message:edit`/`message:delete`. → commit
3. **To-do list:** `todos`-tabel + API, aparte To-do view met checkbox/edit/
   delete, SSE. Hergebruikt edit/delete-patroon uit stap 2. → commit
4. **"Add to-do" in chat-textarea:** knop naast Send. → commit
5. **Afbeeldingen in chat:** upload-knop, paste, server-validatie, disk-opslag
   met UUID, thumbnail + lightbox, copy-to-clipboard, SSE. → commit
6. **Docker-config:** `Dockerfile` + `docker-compose.yml` (volumes `/data` en
   `/data/uploads`). → losse laatste commit.

Elke stap is los werkend en wordt getest met `npm run dev` vóór de commit.
Commit-messages beknopt en beschrijvend (bv. `feat: inline edit & delete voor
chat-berichten`).

## Buiten scope (bewust niet doen)
- Geen tests, geen TypeScript, geen styling-overhaul.
- Geen refactor van wat niet geraakt hoeft (n.v.t. — alles is nieuw).
- Geen extra libraries buiten de 4 hierboven.
- Geen tekst+afbeelding gecombineerd in één bericht (kan later).

---
**Wacht op jouw akkoord voordat ik code schrijf.**
