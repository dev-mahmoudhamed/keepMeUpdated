# keepMeUpdated

Developer news that matters, gathered every morning. Every day at 04:00 the server reads your sources, keeps only new
updates, merges reports of the same story from different sites, writes a short summary with Gemini, and publishes it.
You manage everything from a private admin panel.

- **Site:** a daily edition (lead story + rows) or compact list, topic filters, search, light and dark themes.
- **Post page:** TL;DR, AI summary, and a "Read the original" list with every site that covered the story.
- **Admin (`/admin`):** posts (create, edit, publish, hide, delete) with a rich-text editor, sources (RSS or any web
  page via CSS selectors, with a test fetch), and gather runs (run now, live progress, history and errors).

Built with Angular 22 (standalone, zoneless, signals, `httpResource`) and a small Node/Express API in `server/`.
All data lives in one JSON file: `data/db.json`.

## Setup

Requires Node 24.15+ (or 26+).

```bash
npm install
```

```bash
cp .env.example .env
```

Then edit `.env`:

| Key | What it does |
|---|---|
| `GEMINI_API_KEY` | Your Gemini key from Google AI Studio. Leave empty to run without AI (see below). |
| `GEMINI_MODEL` | Defaults to `gemini-flash-latest`, which follows Google's current free Flash model. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Admin login. **Change the dummy values.** |
| `SESSION_SECRET` | Any long random string. Signs the login cookie. |
| `GATHER_CRON` | When the daily gather runs, in local time. Default `0 4 * * *` (04:00). |
| `PORT` | Port for `npm start`. Default 3000. |
| `HOST` | `127.0.0.1` (default) keeps the site and admin private to this computer. Use `0.0.0.0` to open it to your network, after changing the admin password. |

## Run it

Development (site on http://localhost:4200, API on 3000):

```bash
npm run dev
```

Production (builds the site, then serves site and API together on `PORT`):

```bash
npm run build
```

```bash
npm start
```

The 04:00 gather only happens while the server is running. If the machine was off or asleep at 04:00, the server runs a
catch-up gather when it starts. You can always run one from **Admin → Gather runs → Run gather now**.

## How the daily gather works

1. Fetches every enabled source (RSS/Atom, or a web page read with CSS selectors).
2. Keeps links it hasn't seen before and that are less than 48 hours old.
3. Gemini groups items about the same news, scores how much each matters to developers (0–10), and tags it. Stories
   below 6 are skipped (with a Gemini key only). A story that matches a post from the last 7 days adds its link to that post instead of creating
   a duplicate.
4. Gemini reads the articles and writes a TL;DR, key points and "why it matters". Up to 5 stories per request.
5. New posts are published with links to every source.

**Free-tier budget.** Google's free Gemini quota is small and changes often. Each run makes at most 15 AI requests
(change `maxAiCallsPerRun` in `data/db.json` → `settings`). When the budget or the daily quota runs out, remaining
stories are posted with the sources' own descriptions and marked "summary pending". You can re-summarize any post later
from its edit page.

**Without a key** the app still works: it groups stories by title similarity and publishes every fresh story (it can't
judge relevance without AI), showing the feed's own description as the summary.

## Sources

Twelve developer feeds are added on first start (Angular, React, Next.js, Node.js, TypeScript, GitHub Changelog, Chrome
for Developers, V8, MDN, Deno, Bun, Hacker News 200+ points). Manage them in **Admin → Sources**.

For a site without a feed, choose **Web page with CSS selectors**:

| Field | Example | Meaning |
|---|---|---|
| Each item | `article.post` | One match per story on the page |
| Title | `h2` | Inside the item |
| Link | `a@href` | `@attr` reads an attribute instead of the text |
| Date | `time@datetime` | Optional |
| Summary | `.excerpt` | Optional |

Use **Test fetch** to preview what it finds before saving.

## Data

- `data/db.json` holds posts, sources, run history and seen links. Back it up to keep your data. It's git-ignored.
- If the file is corrupted the server refuses to start rather than overwrite it. Fix or move the file, then restart.

## Tests

```bash
npm run test:server
```

```bash
npx ng test --watch=false
```

## Project layout

```
shared/          types shared by server and site
server/          Express API, JSON store, gather pipeline (fetchers, dedupe, Gemini, scheduler)
src/app/public/  the site: home, day sections, post page
src/app/admin/   admin: login, posts, editor (Tiptap), sources, runs
docs/superpowers design spec and implementation plan
```
