# keepMeUpdated

Developer news that matters, gathered every morning. A GitHub Actions workflow reads the sources in
[sources.md](sources.md), keeps only new updates, merges reports of the same story, writes a short summary with Gemini,
and commits the result. Netlify then builds and publishes the site. News is kept for **30 days**, then deleted. There is
no database: the data is a couple of JSON files in this repository.

- **Site:** Cards or List view, topic filters, search, a white theme with an optional dark theme.
- **Post page:** TL;DR, AI summary, and a "Read the original" list with every site that covered the story.
- **Admin (`/admin`):** write and edit posts with a rich-text editor, publish or hide them, manage sources, and start a
  gather. Sign in with a 6-digit code emailed to the admin address.

## How it works

```
GitHub Actions (03:00 UTC daily, or "Run gather now")
  └─ npm run gather   → reads sources.md, fetches feeds, Gemini summaries, deletes news older than 30 days
  └─ commits content/posts.json + content/state.json

Netlify (on every push to main)
  └─ npm run build    → content/ → public/data/, then the Angular site → dist/keepMeUpdated/browser
  └─ netlify/functions → /api/auth/* (email-code sign-in) and /api/github/* (the admin's repository calls)

Admin panel (in your browser)
  └─ signs in with a code sent to ADMIN_EMAIL; the session is an HttpOnly cookie
  └─ reads/edits content/posts.json and sources.md through /api/github, which uses the site's GitHub token
  └─ every save is a commit, and every commit redeploys the site (about 2 minutes)
```

| Path | What it is |
|---|---|
| `sources.md` | The news sources. Edit it here or in Admin → Sources. |
| `content/posts.json` | All posts from the last 30 days (written by the gather and the admin). |
| `content/state.json` | Seen links, run history, source fetch results, settings. |
| `scripts/` | The gather and build scripts. |
| `netlify/` | The sign-in and admin API functions. |
| `netlify.toml` | Netlify build, publish folder, functions and SPA routing. |
| `.github/workflows/gather.yml` | The daily gather. |
| `src/` | The Angular 22 site and admin panel. |

## Setup (once)

1. **Connect the repository to Netlify** — Add new project → Import from Git → this repository. The build settings come
   from `netlify.toml`; leave the build command and publish directory in the UI empty (or set them to `npm run build`
   and `dist/keepMeUpdated/browser`).
2. **Add your Gemini key to GitHub** — Settings → Secrets and variables → Actions → **New repository secret**:
   name `GEMINI_API_KEY`, value: your key from [Google AI Studio](https://aistudio.google.com/apikey).
   Without it the gather still runs, using the feeds' own descriptions instead of AI summaries.
3. **Create a GitHub token for the site** — GitHub → Settings → Developer settings → Personal access tokens →
   [Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new):
   - Repository access: **Only select repositories** → this repository.
   - Repository permissions: **Contents: Read and write**, **Actions: Read and write**.
4. **Create a [Resend](https://resend.com) account** with the admin email address, and an API key (API Keys → Create).
   Resend's test sender can mail the account's own address without a domain. To send from your own domain, verify it in
   Resend and set `EMAIL_FROM`.
5. **Add the environment variables in Netlify** — Project configuration → Environment variables (scope: Functions):

   | Name | Value |
   |---|---|
   | `ADMIN_EMAIL` | The address that receives sign-in codes. |
   | `RESEND_API_KEY` | From step 4. |
   | `AUTH_SECRET` | A random string of 32+ characters, e.g. `openssl rand -base64 48`. Changing it signs everyone out. |
   | `GITHUB_TOKEN` | From step 3. |
   | `GITHUB_REPO` | `owner/name` of this repository. |
   | `EMAIL_FROM` | Optional, e.g. `keepMeUpdated <admin@yourdomain.com>` (needs a verified domain in Resend). |

   Then **Deploys → Trigger deploy** so the functions pick them up.
6. Open `https://<your-site>.netlify.app/admin`, enter the admin email, and sign in with the code from the email.

No keys live in this repository. The Gemini key is only in GitHub Secrets; the GitHub token, Resend key and auth secret
are only in Netlify's environment variables. The browser never sees any of them.

## Schedule and retention

- The gather runs at **03:00 UTC** = 04:00 UK summer time (03:00 in winter). Change the cron in
  `.github/workflows/gather.yml` and `GATHER_CRON` in `src/app/admin/runs/runs.ts` together.
- Posts and seen links older than **30 days** are deleted on every run (`retentionDays` in `content/state.json` →
  `settings`). Git history still contains older versions of the files; they're small text files.
- Each run makes at most 15 Gemini requests (`maxAiCallsPerRun`), to stay inside the free tier.

## Sources

The news sites live in [sources.md](sources.md), one markdown table per section (Angular, .NET, Cross-stack). The list
was built from the research in [docs/resources](docs/resources), keeping only feeds that were checked to work.
High-volume community feeds (DEV tags, .NET Ramblings, Telerik) are listed but switched off; turn them on once the
Gemini key is set, since the AI filters out the noise.

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

The site opens at http://localhost:4200 with the data from `content/`. For the admin panel, run the site and the
functions together with the Netlify CLI (it reads the environment variables from your Netlify project once you've run
`npx netlify link`):

```bash
npx netlify dev
```

That serves everything on http://localhost:8888.

Run a gather on your machine (changes `content/` files; commit them if you want to keep them):

```bash
npm run gather -- --mode dry-run
```

```bash
GEMINI_API_KEY=your-key npm run gather
```

### Local environment variables (`IS_DEV_ENV`)

To use your own values locally instead of Netlify's:

1. Copy `.env.example` to `.env` (git-ignored) and replace the `dummy dummy dummy` values.
2. In `config/dev-env.ts`, set `IS_DEV_ENV = true`.
3. Run `npx netlify dev` or `npm run gather`. The log lists the variable names it loaded from `.env`.

Set it back to `false` before committing. A test fails while it's `true`, and on Netlify and GitHub Actions the
variables always come from their own settings.

## Tests

```bash
npm run test:scripts
```

```bash
npx ng test --watch=false
```
