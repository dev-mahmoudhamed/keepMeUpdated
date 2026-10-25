# keepMeUpdated

Developer news that matters, gathered every morning. A GitHub Actions workflow reads the sources in
[sources.md](sources.md), collects every article from the last 4 months, posts each story once (with every site that
reported it), writes a short summary with Gemini, and commits the result. Cloudflare Pages then builds and publishes the site.
News is kept for **4 months** (120 days), then deleted. The news is a couple of JSON files in this repository; the only
database is a one-row D1 table holding the admin's pending sign-in code.

- **Site:** Cards or List view, topic filters, search, a white theme with an optional dark theme.
- **Post page:** TL;DR, AI summary, and a "Read the original" list with every site that covered the story.
- **Admin (`/admin`):** write and edit posts with a rich-text editor, publish or hide them, manage sources, start a
  gather, and see in **Report** where every link of a gather went (already on the site, too old, or into which post,
  and the day that post shows under). Sign in with a 6-digit code emailed to the admin address.

## How it works

```
GitHub Actions (03:00 UTC daily, Admin → Gather runs → "Run gather now", or GitHub → Actions → Gather news → Run workflow)
  └─ npm run gather   1. collect: every enabled source, site by site, every article from the last 4 months
                      2. post:    one post per story; a link already on the site is skipped, another site's
                                  report of the same story is added to its post
                      3. summarize: visit the articles of posts still showing the feed text, newest first, Gemini
                      deletes news older than 4 months
  └─ commits content/posts.json + content/state.json

Cloudflare Pages (on every push to main)
  └─ npm run build    → content/ → public/data/, then the Angular site → dist/keepMeUpdated/browser
  └─ functions/api/[[path]].ts → /api/auth/* (email-code sign-in) and /api/github/* (the admin's repository calls)

Admin panel (in your browser)
  └─ signs in with a code sent to ADMIN_EMAIL; the session is an HttpOnly cookie
  └─ reads/edits content/posts.json and sources.md through /api/github, which uses the site's GitHub token
  └─ every save is a commit, and every commit redeploys the site (about 2 minutes)
```

| Path | What it is |
|---|---|
| `sources.md` | The news sources. Edit it here or in Admin → Sources. |
| `content/posts.json` | All posts from the last 4 months (written by the gather and the admin). |
| `content/state.json` | Seen links, run history, source fetch results, settings. |
| `scripts/gather.ts` | The gather command. Its code is in `scripts/lib/`: `fetch.ts` (sources and articles), `ai.ts` (grouping and summaries), `gather.ts` (the three steps), `content.ts` (data files). |
| `scripts/build-data.ts` | Writes `public/data/` for the site before every build. |
| `functions/api/[[path]].ts` | The admin API: one Cloudflare Pages Function for everything under `/api/`. |
| `server/lib.ts` | Its logic: sign-in codes and sessions (Web Crypto, D1) and the GitHub proxy. |
| `shared/` | Types and helpers used by both the scripts and the site. |
| `public/_headers` | Cloudflare response headers (the data files are never cached). |
| `.github/workflows/gather.yml` | The daily gather. |
| `src/` | The Angular 22 site and admin panel. |

## Setup (once)

1. **Create the Pages project** — Cloudflare dashboard → Workers & Pages → Create → **Pages** tab →
   **Import an existing Git repository** → this repository. (Not the Workers flow: it deploys with `wrangler deploy`
   and doesn't run the build below.) Build settings:

   | Setting | Value |
   |---|---|
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist/keepMeUpdated/browser` |
   | Root directory | (empty) |

   Node 24 comes from `.nvmrc`. Deep links like `/p/<slug>` and `/admin` work by themselves: without a `404.html`,
   Pages serves `index.html` for them.
2. **Add your Gemini key to GitHub** — Settings → Secrets and variables → Actions → **New repository secret**:
   name `GEMINI_API_KEY`, value: your key from [Google AI Studio](https://aistudio.google.com/apikey).
   Without it the gather still runs, using the feeds' own descriptions instead of AI summaries.
3. **Create a GitHub token for the site** — GitHub → Settings → Developer settings → Personal access tokens →
   [Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new):
   - Repository access: **Only select repositories** → this repository.
   - Repository permissions: **Contents: Read and write** (saving and starting a gather), **Actions: Read-only**
     (the admin's list of runs).
4. **Create a [Resend](https://resend.com) account** with the admin email address, and an API key (API Keys → Create).
   Resend's test sender can mail the account's own address without a domain. To send from your own domain, verify it in
   Resend and set `EMAIL_FROM`.
5. **Create the sign-in database** — Workers & Pages → D1 SQL Database → Create → name it `keepmeupdated`. Then in the
   Pages project → Settings → Bindings → Add → D1 database: variable name **`DB`**, database `keepmeupdated`. The
   table is created on the first sign-in.
6. **Add the variables in Cloudflare** — the Pages project → Settings → Variables and Secrets (Production), type
   **Secret** for the keys:

   | Name | Value |
   |---|---|
   | `ADMIN_EMAIL` | The address that receives sign-in codes. |
   | `RESEND_API_KEY` | From step 4. |
   | `AUTH_SECRET` | A random string of 32+ characters, e.g. `openssl rand -base64 48`. Changing it signs everyone out. |
   | `GITHUB_TOKEN` | From step 3. |
   | `GITHUB_REPO` | `owner/name` of this repository. |
   | `EMAIL_FROM` | Optional, e.g. `keepMeUpdated <admin@yourdomain.com>` (needs a verified domain in Resend). |

   Then Deployments → the latest one → **Retry deployment** so the function picks them up.
7. Open `https://<your-project>.pages.dev/admin`, enter the admin email, and sign in with the code from the email.

No keys live in this repository. The Gemini key is only in GitHub Secrets; the GitHub token, Resend key and auth secret
are only in Cloudflare's variables and secrets. The browser never sees any of them.

## Schedule and retention

- The gather runs at **03:00 UTC** = 04:00 UK summer time (03:00 in winter). Change the cron in
  `.github/workflows/gather.yml` and `GATHER_CRON` in `src/app/admin/runs/runs.ts` together.
- Every run collects **every article published in the last 4 months** (120 days) from the enabled sources (`retentionDays` in
  `content/state.json` → `settings`). Feeds only list their latest items, so older pages are read too while they're
  still inside the window: WordPress feeds (`?paged=2`), GitHub release feeds (`?page=2`) and feeds with an Atom
  `rel="next"` link, up to 30 pages per feed. Other feeds give what their first page has, which is often less than 4
  months.
- **Every story is posted.** A link that is already in a post is never opened or summarized again, and its post stays.
  Several sites reporting one story become one post with all their links, and the post is summarized again from all of
  them; Gemini is told to leave out facts the sites disagree on. So the site has one card per story.
- **Version updates share one post per major version.** "Angular 22.2.3", "Angular 22.3.0-next.2" and Ninja Squad's
  "What's new in Angular 22.2?" all go into **Angular 22 updates**, newest first, dated by the newest update; Angular 21
  patches go into **Angular 21 updates**. The same works for the CLI, .NET, Aspire, TypeScript and any product whose
  titles read like "Product 1.2.3", "Announcing Product v2", "Product 3 is now available" or "Product 4.1: …".
- New posts first show the feed's description, then Gemini replaces it with a summary, newest posts first. To make the
  free tier go further:
  - **Two models, two quotas.** Each Gemini model has its own free daily quota. The gather uses
    `gemini-flash-latest` and, when its quota for the day is used up, carries on with `gemini-flash-lite-latest`. Set
    `GEMINI_MODELS` (comma-separated) to change the list.
  - **Big batches.** One request summarizes up to 15 posts and groups up to 100 articles, so few requests go a long
    way. Each run makes at most 60 requests (`maxAiCallsPerRun`), at most 8 a minute; grouping uses at most half.
  - **Nothing twice.** A summary is written once and kept; a post is only summarized again when another site reports
    the same story. Links already on the site are never sent to Gemini.
  - When every model's quota is used up the run stops calling Gemini and finishes normally. The posts still waiting
    keep the feed's description and are summarized on the next run, newest first.
  - The first run after widening the window has a large backlog, so summaries fill in over a few days.
- A gathered post whose TL;DR or story you edit becomes yours: the gather won't summarize it again.
- Posts carry the article's own date, so they show on the right day and are deleted 4 months after it.
- Git history still contains older versions of the data files; they're small text files.

## Sources

The news sites live in [sources.md](sources.md), one markdown table per section (Angular, .NET, Both).
[docs/resources/news-sources.md](docs/resources/news-sources.md) lists every site considered, with its tested feed, how
often it posts, and why the others were left out (duplicates, inactive, off-topic or marketing, no working feed).
Every enabled source is posted in full, so a site belongs in the list only if most of what it publishes is worth reading.

For a site without a feed, fill in the **Selectors** column (or choose **Web page with CSS selectors** in the admin):

| Selector | Example | Meaning |
|---|---|---|
| `item` | `article.post` | One match per story on the page |
| `title` | `h2` | Inside the item |
| `link` | `a@href` | `@attr` reads an attribute instead of the text |
| `date` | `time@datetime` | Optional |
| `summary` | `.excerpt` | Optional |

In sources.md that's written as `item=article.post; title=h2; link=a@href`. Check a new source with **Admin → Gather
runs → Dry run**: it fetches every source and lists what each one returned, without saving anything.

## Run it locally

Requires Node 24 LTS (`.nvmrc`).

```bash
npm install
```

```bash
npm run dev
```

The site opens at http://localhost:4200 with the data from `content/`. For the admin panel, build the site and serve it
with the function and a local D1 database the way Cloudflare does (Wrangler reads the variables from `.env`, see below):

```bash
npm run preview
```

That serves everything on http://localhost:8788. Rebuild (run it again) after changing the site.

Run a gather on your machine (changes `content/` files; commit them if you want to keep them):

```bash
npm run gather -- --mode dry-run
```

```bash
GEMINI_API_KEY=your-key npm run gather
```

### Local environment variables (`IS_DEV_ENV`)

Copy `.env.example` to `.env` (git-ignored) and replace the `dummy dummy dummy` values. `npm run preview` always reads
it. For `npm run gather`:

1. In `config/dev-env.ts`, set `IS_DEV_ENV = true`.
2. Run `npm run gather`. The log lists the variable names it loaded from `.env`.

Set it back to `false` before committing. A test fails while it's `true`, and on GitHub Actions the variables always
come from its own settings.

`.wrangler/` (git-ignored) holds the local D1 database `npm run preview` uses.

## Tests

```bash
npm run test:scripts
```

```bash
npx ng test --watch=false
```
