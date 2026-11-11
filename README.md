# The Prime Radiant

Named after the device in Asimov's *Foundation* that lets its readers see how
history is unfolding.

News dashboard for India's neighbours (Pakistan, China, Bangladesh, Myanmar,
Nepal, Bhutan, Afghanistan), with an AI analyst ("Veritas") that answers
questions from the current headlines.

One Node server does everything: it pulls headlines, serves the API, and serves
the website. No database needed.

## Run it

Needs Node 22.13 or newer (for the built-in SQLite).

```
npm install
cp .env.example .env      # then add GROQ_API_KEY or GEMINI_API_KEY (optional)
npm run build
npm start                 # http://localhost:5000
```

For front-end development with hot reload, run these in two terminals:

```
npm run dev:api           # API on :5000, restarts on change
npm run dev               # site on :5173, /api is proxied to :5000
```

## How it works

- **Collection** (`server/feeds.js`) runs every 10 minutes. It reads Google News
  searches for each country plus 34 feeds published by the outlets themselves
  (`FEEDS` in `server/sources.js`): local papers such as Dawn, Dhaka Tribune and
  Kathmandu Post, exile media such as The Irrawaddy and Amu TV, state media such
  as APP and CGTN, and regional outlets (The Diplomat, Al Jazeera, BBC, DW) whose
  stories are kept only when they name one of the seven countries.
- **Storage** (`server/db.js`) is SQLite via Node's built-in `node:sqlite`, in
  `server/.data/osint.db`. Reports are kept for 180 days (`RETENTION_DAYS`) and
  searchable with full-text search on the Archive page.
- **Ownership labels** (`server/sources.js`): every outlet is tagged State media,
  Exile media, Local, Wire, Indian or International. Labels describe who runs an
  outlet, not whether it is accurate. Veritas is told to treat state media as the
  official line rather than independent confirmation. Add outlets to `REGISTRY`.
- **Tagging**: with `GROQ_API_KEY` set, a language model (`server/tagger.js`,
  default `openai/gpt-oss-20b`) tags each new story with country, category and
  priority, and hides what doesn't belong (sport, entertainment, company
  announcements, stories not about the seven countries). It works in the
  background in batches of 40, newest first, paced to Groq's free-tier limits
  (8,000 tokens a minute and 1,000 requests a day; it stops at 800 a day). The
  first run works through the last 48 hours, about 1,000 stories, in roughly
  10-15 minutes. Groq limits each model separately, so tagging on the 20B model
  doesn't eat into Veritas's budget on the 120B model.
  Stories the model hasn't tagged yet (or every story, without a key or with
  `TAG_WITH_LLM=off`) fall back to the keyword rules in `server/classify.js`.
  Both sets of tags are stored; the model's win. Progress is under `tagging`
  in `/api/health`.
- **Duplicates**: reports of the same story are merged ("& 2 more"), preferring the
  outlet's own link over a Google News redirect.
- **Veritas** (`server/veritas.js`) answers with a language model, sending the
  relevant reports along with each question. It uses **Groq** when
  `GROQ_API_KEY` is set (default model `openai/gpt-oss-120b`, change with
  `GROQ_MODEL`; on 2026-11-11 the Llama models were not available to this account), otherwise **Gemini** with `GEMINI_API_KEY`. Without either key
  the rest of the site works. Groq's free tier allows 8,000 tokens per minute,
  so Groq requests carry less context (`CONTEXT_CHARS`, default 8000 characters,
  about two questions a minute); a short rate-limit wait is retried automatically.
  For TL;DR it fetches the article text when the publisher allows it
  (`server/extract.js`). About half the outlets tested block automated readers
  (e.g. Dawn, Irrawaddy, Dhaka Tribune, SCMP), and then it works from headlines
  and summaries and says so.
- **Watchlist** (`server/alerts.js`, Watchlist page): rules of words, places,
  people or groups, optionally limited to countries and a minimum priority.
  After each collection and tagging pass, matching stories become alerts:
  one per story per rule, and only once the story's tags are final (when Groq
  tagging is on), so priorities don't change after the alert. A new rule also
  lists matches from the last 48 hours. Terms are whole words ("LAC" doesn't
  match "lack"); end a term with `*` to match longer words (`militant*`).
  Delivery: in the app (badge on the Watchlist link), desktop notifications
  while the site is open in a tab, and optionally **Telegram**:
  1. In Telegram, message @BotFather, send `/newbot`, and copy the token.
  2. Send any message to your new bot, then open
     `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
  3. Put both in `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`), restart,
     and use "Send test" on the Watchlist page. Tick "Also send to Telegram"
     on the rules you want pushed. Only stories from the last 6 hours that
     appeared after the rule was made are pushed, at most one message per pass.
  Anyone who can open the site can edit the watchlist; add a login before
  putting it on the public internet.
- **Feed health** is recorded on every refresh and shown on the Sources page. A
  feed that keeps failing has probably moved; find its new address and update
  `FEEDS`.

Feeds checked on 2026-11-11 that had no usable RSS (so they only arrive via
Google News): TOLOnews, Pajhwok, Mizzima, Frontier Myanmar, Kuensel, Xinhua,
Global Times, BSS, New Age.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/articles` | `timeFilter` (2min, 15min, 1hour, 6hours, 24hours, 48hours), `country`, `category`, `severity`, `limit` |
| GET | `/api/articles/:id` | |
| GET | `/api/articles/breaking/latest` | last 6 hours |
| GET | `/api/articles/stats/overview` | counts by country / category / severity |
| GET | `/api/articles/meta/sources` | outlets and story counts |
| GET | `/api/veritas/suggestions` | |
| POST | `/api/veritas/ask` | `{ question, conversationHistory }` |
| POST | `/api/veritas/tldr` | `{ articleId }` |
| POST | `/api/veritas/analyze-impact` | `{ sourceCountry, targetCountry }` |
| POST | `/api/veritas/connect-events` | `{ countries, categories, timeframe }` |
| GET | `/api/archive` | `q`, `country`, `category`, `severity`, `source`, `days`, `page` (50 per page) |
| GET | `/api/trends` | `days`: reports per day per country, plus category mix |
| GET | `/api/sources` | outlets with ownership labels, and direct-feed health |
| GET/POST | `/api/watchlist` | list / create rules `{ name, terms, countries, minSeverity, telegram }` |
| PATCH/DELETE | `/api/watchlist/:id` | edit (incl. `enabled`) / delete a rule and its alerts |
| GET | `/api/alerts` | `unread=1`, `rule`, `limit` |
| GET | `/api/alerts/count` | unread count, newest alert id (polled by the page) |
| POST | `/api/alerts/read` | `{ ids: [...] }` or `{ all: true }` |
| GET | `/api/health` | |

Veritas is limited to 10 questions per minute per visitor (`VERITAS_PER_MINUTE`).

## Deploying

Any host that runs Node works (Render, Railway, Fly.io, a VPS). Build command
`npm install && npm run build`, start command `npm start`, and set
`GROQ_API_KEY` (or `GEMINI_API_KEY`) in the host's environment settings, never in the code. The host sets `PORT`.
The archive lives in a SQLite file, so give the server a **persistent disk** and
point `DATA_DIR` at it. On hosts with throwaway disks (most free tiers) the live
feed still works, but the archive resets whenever the server restarts.

The original compiled build is kept in `_original_build/` for reference.
