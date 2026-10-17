# keepMeUpdated

Developer news that matters, gathered every morning. A GitHub Actions workflow reads the sources in
[sources.md](sources.md), keeps only new updates, merges reports of the same story, writes a short summary with Gemini,
and publishes a static site on GitHub Pages. News is kept for **30 days**, then deleted. There is no server and no
database: the data is a couple of JSON files in this repository.

- **Site:** Cards or List view, topic filters, search, a white theme with an optional dark theme.
- **Post page:** TL;DR, AI summary, and a "Read the original" list with every site that covered the story.
- **Admin (`/admin`):** write and edit posts with a rich-text editor, publish or hide them, manage sources, and start a
  gather — all from the browser, signed in with a GitHub token.

## How it works

```
GitHub Actions (03:00 UTC daily, or "Run gather now")
  └─ npm run gather   → reads sources.md, fetches feeds, Gemini summaries, deletes news older than 30 days
  └─ commits content/posts.json + content/state.json
  └─ builds the Angular site and deploys it to GitHub Pages

Admin panel (in your browser)
  └─ reads/edits content/posts.json and sources.md through the GitHub API (each save is a commit)
  └─ every commit redeploys the site (about 2 minutes)
```

| Path | What it is |
|---|---|
| `sources.md` | The news sources. Edit it here or in Admin → Sources. |
| `content/posts.json` | All posts from the last 30 days (written by the gather and the admin). |
| `content/state.json` | Seen links, run history, source fetch results, settings. |
| `scripts/` | The gather and build scripts that Actions runs. |
| `.github/workflows/` | `gather.yml` (daily gather) and `deploy.yml` (build + Pages). |
| `src/` | The Angular 22 site and admin panel. |

## Setup (once)

1. **Make the repository public** — Settings → General → Danger zone → Change visibility. (GitHub Pages is free for
   public repositories.)
2. **Turn on Pages** — Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. **Add your Gemini key** — Settings → Secrets and variables → Actions → **New repository secret**:
   name `GEMINI_API_KEY`, value: your key from [Google AI Studio](https://aistudio.google.com/apikey).
   Without it the gather still runs, using the feeds' own descriptions instead of AI summaries.
4. **Create your admin token** — GitHub → Settings → Developer settings → Personal access tokens →
   [Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new):
   - Repository access: **Only select repositories** → this repository.
   - Repository permissions: **Contents: Read and write**, **Actions: Read and write**.
   - Save it in your password manager. Sign in at `https://<you>.github.io/keepMeUpdated/admin` by pasting it.
5. Push to `main`. The deploy workflow publishes the site; the first gather runs at the next 03:00 UTC, or start it
   from **Actions → Gather news → Run workflow** (or Admin → Gather runs).

No passwords or keys live in this repository or on your computer. The Gemini key is only in GitHub Secrets; the admin
token is only in your browser (for this tab, or for this device if you tick "Keep me signed in").

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

The site opens at http://localhost:4200 with the data from `content/`. The admin panel works locally too, against the
real repository on GitHub (sign in with your token).

Run a gather on your machine (changes `content/` files; commit them if you want to keep them):

```bash
npm run gather -- --mode dry-run
```

```bash
GEMINI_API_KEY=your-key npm run gather
```

## Tests

```bash
npm run test:scripts
```

```bash
npx ng test --watch=false
```
