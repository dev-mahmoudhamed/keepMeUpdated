# keepMeUpdated — Design Spec

Date: 2026-10-17
Status: Approved in chat, pending written-spec review

## 1. Purpose

A personal, auto-curated developer news site. Every day at 04:00 a job reads a list of
sources, keeps only genuinely new updates that matter to developers, merges reports of
the same story from multiple sites, writes an AI summary with Gemini, and publishes it.
A single admin (the owner) can manage posts, sources and runs, and edit or create posts
with a rich-text editor.

### Success criteria

- `npm run dev` brings up the site and API locally; `npm run build && npm start` runs it as one process.
- A gather run (scheduled or manual) produces published posts with a TL;DR, key points,
  "why it matters", tags, and links to *every* source that covered the story.
- The same story reported by several sources yields one post with all links, including
  when a later run finds a new source for a story already posted (within 7 days).
- Everything works without a Gemini key (fallback mode); adding the key upgrades quality.
- Distinct, eye-friendly UI (warm paper + ink + moss accent; no violet/blue), daily
  edition layout with a compact list toggle, light and dark themes, WCAG AA contrast.
- Admin is reachable only after login; all admin API routes reject unauthenticated calls.

### Out of scope (for now)

Multi-user accounts, comments, newsletters/email, SSR/SEO, deployment configs (Docker,
PaaS), a real database. The JSON store sits behind a repository interface so it can be
swapped later.

## 2. Architecture

```
keepMeUpdated/
├─ src/                    Angular app (public site + lazy-loaded /admin)
├─ server/
│  ├─ index.ts             Express 5 app bootstrap, static hosting of dist in prod
│  ├─ config.ts            env loading + validation
│  ├─ store/               JsonStore (atomic writes, serialized write queue) + repositories
│  ├─ gather/
│  │  ├─ fetchers/         rss.ts, html.ts  (Source -> RawItem[])
│  │  ├─ extract.ts        article text extraction for summarization
│  │  ├─ dedupe.ts         URL normalization + title-similarity fallback clustering
│  │  ├─ ai.ts             Gemini client: triage (group/score/tag) + summarize
│  │  ├─ pipeline.ts       orchestrates a run, writes Run log
│  │  └─ scheduler.ts      node-cron 04:00 local + startup catch-up
│  ├─ api/                 public.ts, auth.ts, admin/*.ts
│  └─ seed.ts              default sources on first boot
├─ data/db.json            created on first boot (git-ignored)
└─ .env / .env.example
```

- **Dev:** `npm run dev` uses `concurrently` to start `ng serve` (proxy `/api` → `:3000`) and
  `tsx watch server/index.ts`.
- **Prod:** `npm run build` builds Angular; `npm start` runs the server, which serves
  `/api/*` and the built SPA (with fallback to `index.html`).

### Configuration (`.env`)

| Key | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `GEMINI_API_KEY` | empty | Empty puts the app in fallback mode |
| `GEMINI_MODEL` | `gemini-flash-latest` | Alias that tracks the current free-tier Flash model |
| `ADMIN_EMAIL` | `admin@keepmeupdated.local` | Dummy, owner changes later |
| `ADMIN_PASSWORD` | `ChangeMe!2026` | Dummy, owner changes later |
| `SESSION_SECRET` | random on first boot if missing (with warning) | Signs the session cookie |
| `GATHER_CRON` | `0 4 * * *` | Local time |
| `TZ` | system | |

## 3. Data model (`data/db.json`)

```ts
interface Db {
  version: 1;
  posts: Post[];
  sources: Source[];
  runs: Run[];            // last 50 kept
  seen: Record<string, string>; // normalizedUrl -> ISO date first seen; pruned after 60 days
  settings: { relevanceThreshold: number; maxItemAgeHours: number; maxAiCallsPerRun: number }; // 6, 48, 15
}

interface Source {
  id: string; name: string; siteUrl: string;
  type: 'rss' | 'html';
  feedUrl: string;                 // rss: feed url; html: page url
  selectors?: { item: string; title: string; link: string; date?: string; summary?: string };
  defaultTags: string[];
  enabled: boolean;
  lastFetchedAt?: string; lastError?: string; lastItemCount?: number;
}

interface PostSource { sourceId?: string; siteName: string; url: string; title: string; publishedAt?: string }

interface Post {
  id: string; slug: string;
  title: string;
  tldr: string;                    // 1–2 sentences, plain text
  bodyHtml: string;                // sanitized; key points + why it matters (editable)
  tags: string[];
  sources: PostSource[];           // >= 1 for auto posts
  relevance: number;               // 0–10; used to pick each day's lead story
  status: 'published' | 'draft' | 'hidden';
  origin: 'auto' | 'manual';
  aiPending: boolean;              // true when created in fallback mode
  createdAt: string; updatedAt: string; publishedAt?: string;
  runId?: string;
}

interface Run {
  id: string; trigger: 'cron' | 'manual' | 'catch-up';
  startedAt: string; finishedAt?: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  stats: { fetched: number; fresh: number; clusters: number; created: number; merged: number; skipped: number };
  errors: { sourceId?: string; message: string }[];
  log: string[];                   // human-readable progress lines for the admin UI
}
```

### Store guarantees

- All writes go through one in-process queue; each write serializes the whole DB to
  `db.json.tmp` and then `rename`s it over `db.json` (atomic on the same volume).
- Reads come from an in-memory copy loaded at boot.
- Only one gather run at a time; triggering while running returns `409` with the current run id.

## 4. Gather pipeline

1. **Fetch** every enabled source in parallel (concurrency 4, 15 s timeout, browser-like
   UA). RSS/Atom via `rss-parser`; HTML via `fetch` + `cheerio` using the source's
   selectors with relative links resolved. Per-source failures are recorded on the source
   and in the run's `errors`; the run continues.
2. **Freshness:** normalize URLs (strip `utm_*`, hash, trailing slash, lowercase host);
   drop items already in `seen` or older than `maxItemAgeHours`. Items without a date count as fresh
   unless seen. Mark all fetched URLs as seen *after* the run finishes.
3. **Triage**
   - **Gemini mode:** one call per batch of ≤ 40 items (title, snippet, source, url), plus the
     titles/ids of posts from the last 7 days. Structured JSON output (`responseSchema`):
     `clusters: [{ itemIds[], existingPostId?, relevance 0–10, tags[], reason }]`.
     Clusters below `relevanceThreshold` are skipped (counted in stats).
   - **Fallback mode:** cluster by token-set Jaccard similarity of titles (≥ 0.5) and
     match existing posts the same way. Relevance = 5 + small boosts (multiple sources,
     release/version keywords). Tags = union of the sources' `defaultTags`.
4. **Merge or create**
   - Cluster with `existingPostId`: append any new links to that post's `sources`. No re-summary.
   - New cluster: extract article text from up to 3 links (`<article>`/`<main>`/paragraphs,
     capped at ~6k chars per story), then in Gemini mode summarize **up to 5 stories per call** → JSON
     `{ stories: [{ clusterId, title, tldr, keyPoints[], whyItMatters, tags[] }] }`, rendered to `bodyHtml`.
     Fallback: title = the first item's title, tldr = feed snippet (truncated), body = the snippets,
     `aiPending = true`.
5. **Publish:** new posts are `published` with `publishedAt = now`; `slug` comes from the
   title with a uniqueness suffix.
6. **Gemini budget and resilience:** the free tier is small and unstable (daily request caps can be ~20),
   so each run makes at most `maxAiCallsPerRun` calls (triage first, then summaries by relevance). Once the
   budget is spent, the remaining stories use the fallback form with `aiPending = true`. Calls are throttled to ≤ 8/min; 429/5xx are retried with backoff
   (max 3); a 429 that says the daily quota is exhausted stops AI use for the rest of the run. If triage fails, that batch uses the fallback. If a summary fails, the post is
   created in fallback form with `aiPending = true`.

**Scheduler:** `node-cron` using `GATHER_CRON`. On boot, if the last successful/partial run
started more than 24 h ago and the current local time is past today's scheduled time, start
a `catch-up` run.

**Admin re-summarize:** an action on a post (only when a key is configured) re-runs
summarize for its links and clears `aiPending`.

## 5. HTTP API

Public:
- `GET /api/posts?days=7&before=YYYY-MM-DD&tag=&q=` → published posts grouped by day
  `{ days: [{ date, posts: PostSummary[] }], nextBefore? }`
- `GET /api/posts/:slug` → full published post (404 otherwise)
- `GET /api/tags` → tags with counts (published only)

Auth:
- `POST /api/auth/login` `{email,password}` → sets an HttpOnly, SameSite=Strict, signed session
  cookie (7 days). Credentials are compared in constant time. Rate limited to 5 attempts/min per IP.
- `POST /api/auth/logout`, `GET /api/auth/me`

Admin (auth middleware on all routes):
- Posts: `GET /api/admin/posts?status=&q=`, `GET/POST/PUT/DELETE /api/admin/posts/:id`,
  `POST /api/admin/posts/:id/resummarize`
- Sources: `GET/POST/PUT/DELETE /api/admin/sources[/:id]`, `POST /api/admin/sources/test`
  (body: source config → first 10 parsed items, nothing saved)
- Runs: `GET /api/admin/runs`, `GET /api/admin/runs/:id`, `POST /api/admin/runs` (start → `202 {id}`;
  `409` if one is running)
- `GET /api/admin/status` → `{ geminiConfigured, model, nextRunAt, running }`

Validation with `zod` on every body. `bodyHtml` is sanitized with `sanitize-html`
(allow-list: headings h2–h4, p, lists, blockquote, code/pre, a[href, rel, target], strong, em,
img[src, alt], hr). Errors are returned as `{ error: string }` with the right status code.

## 6. Frontend

### Stack and conventions
Latest stable Angular. Standalone components, zoneless change detection, signals,
`httpResource`/`resource` for data, `input()`/`output()`/`model()`, built-in control
flow, `@defer` for the editor, functional guards and interceptors, `withViewTransitions()`,
lazy `/admin` routes. Plain CSS with design tokens (no UI kit). Icons: `lucide-angular`.
Editor: Tiptap (`@tiptap/core`, `starter-kit`, `extension-link`, `extension-placeholder`,
`extension-image`) wrapped in a custom component with its own toolbar.

### Design system
| Token | Light | Dark |
|---|---|---|
| `--paper` (page) | `#F6F1E7` | `#171512` |
| `--paper-raised` (cards, inputs) | `#FBF8F2` | `#201D19` |
| `--ink` (text) | `#1F1C17` | `#ECE5D8` |
| `--ink-soft` (secondary) | `#4A443B` | `#BDB4A4` |
| `--ink-muted` (meta) | `#6B6358` | `#958C7E` |
| `--rule` (hairlines) | `#D9D0BF` | `#3A352E` |
| `--accent` (moss) | `#2E5A3F` | `#8DBF9C` |
| `--accent-wash` (tag bg) | `#E3EBDD` | `#24332A` |
| `--danger` | `#9B2C1F` | `#E8907F` |
| `--highlight` (TL;DR box) | `#EFE6CF` | `#2A251C` |

All text/background pairs must meet WCAG AA (≥ 4.5:1 for body text); verified during implementation.

- **Type:** Newsreader (headlines, opsz axis), Atkinson Hyperlegible (body/UI, 18px base on
  reading pages, 16px in UI, line-height 1.6, measure ~68ch), JetBrains Mono (tags, dates, meta).
- **Motion:** 150–250 ms ease-out hovers; view transitions between list and post;
  everything disabled under `prefers-reduced-motion`.
- **Theme:** follows the system by default; a toggle in the masthead stores the choice in `localStorage`.

### Public pages
- **Home `/`:** masthead (wordmark, date, theme toggle) → toolbar (search, topic chips,
  edition/compact toggle stored in `localStorage`) → day sections. In edition view, each day
  shows its highest-relevance post as the lead (headline, TL;DR, tags, source count), then rows
  (headline, tag, source count, time). Compact view shows one line per post. "Load older days"
  paginates with `before`. Empty, loading (skeleton) and error states are designed.
- **Post `/p/:slug`:** back link, tags, headline, date and source count, TL;DR in a highlight box,
  `bodyHtml`, "Read the original" list (favicon, site name, article title, external-link icon,
  `rel="noopener noreferrer"`, opens in a new tab), and an "AI-generated summary" note (or a
  "summary pending" note when `aiPending`).
- `**` → a designed 404 page.

### Admin `/admin` (lazy, guarded)
- `/admin/login`
- `/admin` → Posts: table (title, status pill, origin, sources, date), search and status
  filter, row actions (edit, publish/unpublish, delete with confirm), "New post".
- `/admin/posts/new`, `/admin/posts/:id`: form (title, slug auto from title and editable, TL;DR,
  tags chip input, status, sources list add/remove/edit) + Tiptap body editor; save, cancel,
  re-summarize (when Gemini is configured), and a guard against leaving with unsaved changes.
- `/admin/sources`: list with enabled toggle, last fetch/error; create/edit drawer with type
  switch (RSS/HTML), selector fields for HTML, and a "Test fetch" preview.
- `/admin/runs`: "Run gather now" button (disabled with progress while running; polls
  `/runs/:id` every 2 s), status card (Gemini configured?, next scheduled run), history list
  with expandable log and errors.

## 7. Default sources (seeded on first boot; each URL verified during implementation)

Angular Blog, React Blog, Next.js Blog, Node.js Blog, TypeScript Blog, GitHub Changelog,
Chrome for Developers, V8 Blog, MDN Blog, Deno Blog, Bun Blog, Hacker News (front page,
≥ 200 points via hnrss). Feeds that cannot be verified are left out and reported.

## 8. Testing

- **Server (Vitest):** URL normalization; Jaccard clustering; the RSS fetcher against fixture XML; the HTML
  fetcher against fixture HTML and selectors; the JSON store (atomic write, queueing); the pipeline end to end
  with mocked fetch and a mocked AI client (create, merge into existing, skip low relevance,
  per-source failure → partial); auth middleware; sanitization.
- **Frontend:** component tests for the day-grouping/lead selection logic, the view toggle, and the
  auth guard.
- **Manual verification:** run the dev stack, run a real gather in fallback mode, browse
  the home and post pages in light and dark themes at 375/768/1440 px, and run admin CRUD and editor flows.

## 9. Security notes

Admin credentials and the session secret live only in `.env` (git-ignored; `.env.example`
committed). Cookies are HttpOnly + SameSite=Strict (+ Secure in production). All admin
routes require a session. External HTML is never rendered unsanitized. Outbound fetches
only go to configured source URLs and the links they return.
