# keepMeUpdated Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, auto-curated developer news site. A daily 04:00 job gathers sources, dedupes and merges stories, and summarizes them with Gemini; the public site is an Angular "daily edition"; a single-admin panel has CRUD, a rich-text editor, sources and runs.

**Architecture:** One repo. The Angular 22 SPA lives at the root (`src/`) and the Node/Express 5 API lives in `server/` (run with `tsx`, no compile step). Both share types from `shared/models.ts`. All state is in `data/db.json` behind a `JsonStore` with atomic writes. The gather pipeline is pure orchestration over injected fetchers and an injected `AiClient`, so it is fully testable with mocks.

**Tech Stack:** Angular 22 (standalone, zoneless, signals, `httpResource`, Vitest runner), Express 5.3, tsx 4, `@google/genai` 2.x, rss-parser 3.13, cheerio 1.2, node-cron 4, zod 4, sanitize-html 2.18, cookie-parser, express-rate-limit, Tiptap 3 (`@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-placeholder`, `@tiptap/extension-image`), lucide-angular, Vitest 5 + supertest (server), concurrently, dotenv.

**Spec:** `docs/superpowers/specs/2026-10-17-keepmeupdated-design.md`

## Global Constraints

- Node ≥ 24 (installed: 24.9.0). Windows dev machine: use `path.join`, never hard-coded `/` separators in fs code.
- Angular project name `keepMeUpdated`, generated **in the repo root** (`--directory .`), CSS styles, routing on, SSR off, zoneless (default in v22).
- Config keys and defaults exactly as in spec §2: `PORT=3000`, `GEMINI_MODEL=gemini-flash-latest`, `ADMIN_EMAIL=admin@keepmeupdated.local`, `ADMIN_PASSWORD=ChangeMe!2026`, `GATHER_CRON=0 4 * * *`.
- Settings defaults: `relevanceThreshold: 6`, `maxItemAgeHours: 48`, `maxAiCallsPerRun: 15`. Runs kept: 50. `seen` pruned after 60 days. Merge window: posts from the last 7 days.
- Fetch: concurrency 4, timeout 15 000 ms. Triage batch ≤ 40 items. Summaries: ≤ 5 stories per call, ≤ 6 000 chars of article text per story, ≤ 3 links per story. Gemini throttle ≤ 8 calls/min, retry 429/5xx max 3.
- Fallback clustering: title token-set Jaccard ≥ 0.5.
- Design tokens exactly as spec §6 table (light/dark hex values). Fonts: Newsreader, Atkinson Hyperlegible, JetBrains Mono. No violet/blue anywhere in the UI. Icons: lucide only, no emoji.
- UI copy is sentence case. No "successfully", no "please", no exclamation marks in system copy.
- No secrets committed: `.env` and `data/` are git-ignored; `.env.example` is committed.
- Commit after every task, with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A source returns garbage** (an HTML error page instead of a feed, invalid XML, or a 403): the run must finish as `partial`, with that source's `lastError` set and other sources' posts created. → Task 7 test `marks run partial when one source throws`.
2. **Gemini returns malformed or hallucinated output** (invalid JSON, item ids not in the batch, an `existingPostId` that doesn't exist): it is validated with zod; bad clusters are dropped or repaired, and the batch falls back without crashing the run. → Task 6 tests `rejects unknown item ids` and `falls back on invalid JSON`.
3. **Two runs at once** (the cron fires while an admin-triggered run is still going): the second is refused (`409` from the API, skipped by cron) and the DB is never written by two runs. → Task 7 test `refuses a second concurrent run`, Task 9 test `POST /runs returns 409 while running`.
4. **Hostile HTML** (`<script>`, `onerror=`, `javascript:` links in feed snippets or admin-entered body): it is stripped before storage and rendering. → Task 5 test `strips scripts, handlers and javascript urls`.
5. **`db.json` missing or corrupted at boot**: missing → created with seed sources; corrupted → the server refuses to start with a clear message naming the file and never overwrites it. → Task 2 test `throws on corrupted file and leaves it untouched`.

---

## File Structure

```
shared/models.ts                 All shared interfaces (Db, Post, PostSummary, Source, Run, PostSource, Settings, DayGroup, FeedResponse, AdminStatus)
server/
  index.ts                       boot: load config, open store, seed, start scheduler, listen
  app.ts                         createApp(deps) -> express.Application (no listen; used by tests)
  config.ts                      loadConfig(env) -> Config
  store/json-store.ts            JsonStore: load/read/update with atomic write queue
  store/seed.ts                  DEFAULT_SOURCES, ensureSeed(store)
  util/ids.ts                    newId(), slugify(), uniqueSlug()
  util/sanitize.ts               sanitizeHtml(html), renderStoryBody(keyPoints, whyItMatters)
  gather/types.ts                RawItem, Cluster, StorySummary, AiClient, Fetcher interfaces
  gather/dedupe.ts               normalizeUrl, titleTokens, jaccard, clusterByTitle, matchExisting
  gather/fetchers/rss.ts         fetchRss(source, http) -> RawItem[]
  gather/fetchers/html.ts        fetchHtml(source, http) -> RawItem[]
  gather/fetchers/index.ts       fetchSource(source, http)
  gather/http.ts                 httpGet(url, timeoutMs) -> {status, text, finalUrl}
  gather/extract.ts              extractArticleText(html, maxChars)
  gather/ai/gemini.ts            GeminiAiClient implements AiClient
  gather/ai/fallback.ts          FallbackAiClient implements AiClient
  gather/ai/budget.ts            AiBudget (call cap + throttle + quota stop)
  gather/pipeline.ts             GatherService: start(trigger), isRunning(), runOnce(...)
  gather/scheduler.ts            startScheduler(cron, service, store), shouldCatchUp(lastRun, now, cron)
  api/public.ts                  publicRouter(store)
  api/auth.ts                    authRouter(config), requireAdmin middleware, session sign/verify
  api/admin-posts.ts, admin-sources.ts, admin-runs.ts
  api/feed.ts                    groupByDay(posts, opts) (pure, used by public router)
server/**/*.test.ts              co-located Vitest tests; fixtures in server/test/fixtures/
src/
  styles.css                     tokens, fonts, base typography, utilities
  app/app.config.ts, app.routes.ts, app.ts
  app/core/api.ts                typed endpoints (URL builders + HttpClient calls)
  app/core/theme.service.ts      ThemeService
  app/core/prefs.ts              storage helpers (try/catch)
  app/core/auth.ts               AuthService, authGuard, credentialsInterceptor
  app/public/masthead/, home/, day-section/, post-row/, post-page/, not-found/
  app/public/feed-utils.ts       pickLead(), formatDay()
  app/admin/admin-shell/, login/, posts-list/, post-editor/, rich-editor/, sources/, runs/
proxy.conf.json, vitest.server.config.ts, tsconfig.server.json, .env.example
```

---

### Task 1: Scaffold workspace

**Files:**
- Create: Angular workspace at the repo root, `proxy.conf.json`, `vitest.server.config.ts`, `tsconfig.server.json`, `.env.example`, `server/smoke.test.ts`
- Modify: `package.json` (scripts, deps), `angular.json` (serve proxyConfig), `.gitignore`

**Interfaces:**
- Produces: scripts `dev`, `build`, `start`, `test` (Angular), `test:server`; the proxy `/api → http://localhost:3000`.

- [ ] **Step 1: Generate Angular in place**

Run: `npx -y @angular/cli@22 new keepMeUpdated --directory . --style css --routing --ssr false --skip-git --package-manager npm --defaults`
Expected: `src/app/app.ts` exists, and `ng version` shows 22.x. If the CLI refuses the non-empty directory, generate into `../kmu-tmp` and move everything except `.git` in.

- [ ] **Step 2: Install server deps**

Run: `npm i express@5 cookie-parser express-rate-limit zod sanitize-html rss-parser cheerio node-cron @google/genai dotenv` and `npm i -D tsx vitest@5 supertest @types/express @types/cookie-parser @types/sanitize-html @types/supertest concurrently`

- [ ] **Step 3: Config files**
  - `tsconfig.server.json`: extends the root, `module: nodenext`, `moduleResolution: nodenext`, `include: ["server", "shared"]`, `noEmit`.
  - `vitest.server.config.ts`: `test.include = ['server/**/*.test.ts']`, `environment: 'node'`.
  - Scripts:
    - `"dev": "concurrently -n api,web -c green,yellow \"tsx watch server/index.ts\" \"ng serve --proxy-config proxy.conf.json\""`
    - `"start": "tsx server/index.ts"`
    - `"test:server": "vitest run -c vitest.server.config.ts"`
  - `.gitignore` additions: `.env`, `data/`.
  - `.env.example` with every key from the spec §2 table.

- [ ] **Step 4: Smoke test**

`server/smoke.test.ts`: `it('runs', () => expect(1 + 1).toBe(2))`.
Run: `npm run test:server` → PASS. Run: `npx ng build` → success. Run: `npx ng test --watch=false` → the generated tests pass.

- [ ] **Step 5: Commit** `chore: scaffold Angular 22 workspace and server tooling`

---

### Task 2: Shared models, config and JsonStore

**Files:**
- Create: `shared/models.ts`, `server/config.ts`, `server/store/json-store.ts`, `server/util/ids.ts`
- Test: `server/store/json-store.test.ts`, `server/util/ids.test.ts`, `server/config.test.ts`

**Interfaces:**
- Produces:
  - `shared/models.ts`: the `Db`, `Source`, `Post`, `PostSource` and `Run` interfaces exactly as in spec §3, plus:
    - `Settings`
    - `PostSummary = Pick<Post, 'id'|'slug'|'title'|'tldr'|'tags'|'relevance'|'publishedAt'|'aiPending'> & { sourceCount: number }`
    - `DayGroup = { date: string /* YYYY-MM-DD */; posts: PostSummary[] }`
    - `FeedResponse = { days: DayGroup[]; nextBefore?: string }`
    - `AdminStatus = { geminiConfigured: boolean; model: string; nextRunAt: string | null; running: string | null }`
  - `server/config.ts`: `Config { port, geminiApiKey?, geminiModel, adminEmail, adminPassword, sessionSecret, gatherCron, dataDir, isProd }`. Exported as `loadConfig(env: NodeJS.ProcessEnv): Config`. When `SESSION_SECRET` is missing it generates a random 32-byte secret and logs a warning once.
  - `server/store/json-store.ts`:
    - `class JsonStore { static open(filePath: string, init: () => Db): Promise<JsonStore>; read(): Readonly<Db>; update<T>(fn: (db: Db) => T): Promise<T> }`
    - `update` runs `fn` on the in-memory DB and then persists through a promise-chain queue: write `db.json.tmp`, then `fs.rename`.
    - `open` on a missing file creates it from `init()`. On invalid JSON it throws `Error("data/db.json is not valid JSON — fix or move it; refusing to overwrite")` and never writes.
  - `server/util/ids.ts`: `newId(): string` (randomUUID), `slugify(text: string): string`, `uniqueSlug(text: string, taken: Set<string>): string`.

- [ ] **Step 1: Write failing tests**

```ts
// json-store.test.ts (use a temp dir per test via fs.mkdtemp(os.tmpdir()))
it('creates file from init when missing', ...)            // file exists, read().posts.length === 0
it('persists updates atomically and sequentially', ...)   // 20 concurrent update() calls each push a post -> reopen -> 20 posts, no .tmp left
it('throws on corrupted file and leaves it untouched', ...) // write '{oops' -> open rejects /not valid JSON/ -> file content still '{oops'
// ids.test.ts
expect(slugify('Angular 22 ships Zoneless!')).toBe('angular-22-ships-zoneless')
expect(slugify('مرحبا')).toBe('')                          // non-latin -> empty
expect(uniqueSlug('Hello', new Set(['hello']))).toBe('hello-2')
expect(uniqueSlug('مرحبا', new Set())).toMatch(/^post-[a-z0-9]{6}$/)
// config.test.ts
expect(loadConfig({}).geminiModel).toBe('gemini-flash-latest')
expect(loadConfig({}).port).toBe(3000)
expect(loadConfig({ PORT: '4000' }).port).toBe(4000)
```

- [ ] **Step 2:** Run `npm run test:server` → FAIL (modules missing)
- [ ] **Step 3:** Implement the three modules per the Interfaces.
- [ ] **Step 4:** Run `npm run test:server` → PASS
- [ ] **Step 5: Commit** `feat(server): shared models, config, atomic JSON store`

---

### Task 3: Dedupe utilities

**Files:**
- Create: `server/gather/types.ts`, `server/gather/dedupe.ts`
- Test: `server/gather/dedupe.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `RawItem { id: string; sourceId: string; siteName: string; title: string; url: string; snippet: string; publishedAt?: string }`. `id` is the item's index-based key within a run, e.g. `i12`.
  - `Cluster { id: string; itemIds: string[]; existingPostId?: string; relevance: number; tags: string[] }`
  - `StorySummary { clusterId: string; title: string; tldr: string; keyPoints: string[]; whyItMatters: string; tags: string[] }`
  - `interface AiClient { readonly mode: 'gemini' | 'fallback'; triage(items: RawItem[], recent: { id: string; title: string }[], defaultTags: Record<string,string[]>): Promise<Cluster[]>; summarize(stories: { clusterId: string; items: RawItem[]; text: string }[]): Promise<StorySummary[]> }`
- Produces (`dedupe.ts`):
  - `normalizeUrl(url: string): string`: lowercase host, drop `www.`, the hash, `utm_*`/`ref`/`fbclid` params and the trailing slash, then sort the remaining params.
  - `titleTokens(t: string): Set<string>`: lowercase, split on non-alphanumerics, drop tokens shorter than 3 and English stopwords.
  - `jaccard(a: Set<string>, b: Set<string>): number`
  - `clusterByTitle(items: RawItem[], threshold = 0.5): string[][]`: greedy single-link clustering; returns arrays of item ids.
  - `matchExisting(title: string, recent: {id: string; title: string}[], threshold = 0.5): string | undefined`

- [ ] **Step 1: Write failing tests**

```ts
expect(normalizeUrl('https://www.Example.com/a/?utm_source=x&b=2&a=1#top')).toBe('https://example.com/a?a=1&b=2')
expect(jaccard(new Set(['a','b']), new Set(['b','c']))).toBeCloseTo(1/3)
// clusterByTitle: 'Angular 22 released with zoneless default' + 'Angular 22 released: zoneless by default' cluster together; 'Node 26 LTS' stays alone
expect(clusterByTitle(items).map(c => c.length).sort()).toEqual([1, 2])
expect(matchExisting('Angular 22 is released with zoneless', [{id:'p1', title:'Angular 22 released, zoneless default'}])).toBe('p1')
expect(matchExisting('Bun 2.0', [{id:'p1', title:'Angular 22 released'}])).toBeUndefined()
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(gather): url normalization and title clustering`

---

### Task 4: Fetchers (RSS + HTML) and HTTP helper

**Files:**
- Create: `server/gather/http.ts`, `server/gather/fetchers/rss.ts`, `html.ts`, `index.ts`, fixtures `server/test/fixtures/feed.rss.xml`, `feed.atom.xml`, `listing.html`
- Test: `server/gather/fetchers/fetchers.test.ts`

**Interfaces:**
- Produces:
  - `type HttpGet = (url: string, timeoutMs?: number) => Promise<{ status: number; text: string; finalUrl: string }>`
  - `httpGet: HttpGet`: global `fetch` with `AbortSignal.timeout`, a UA header `keepMeUpdated/1.0 (+local)` and `Accept` set; it throws `Error("HTTP <status> for <url>")` for non-2xx responses.
  - `fetchRss(source: Source, http: HttpGet): Promise<Omit<RawItem,'id'>[]>`: `rss-parser` `parseString`. Snippet = `contentSnippet` (or stripped `content`), truncated to 500 chars. Throws `Error("Not a valid RSS/Atom feed")` when parsing fails.
  - `fetchHtml(source: Source, http: HttpGet)`: cheerio with `source.selectors`; links are resolved against `finalUrl`; items without a title or link are skipped; throws when there are 0 items (`"Selector matched no items"`).
  - `fetchSource(source, http)` dispatches on `source.type`.

- [ ] **Step 1: Write failing tests** (a fake `http` returns fixture text)

```ts
it('parses RSS 2.0 items', ...)   // 3 items, first has title/url/publishedAt ISO, snippet <= 500 chars
it('parses Atom entries', ...)    // 2 items
it('throws on HTML served as feed', ...)  // fetchRss with listing.html -> rejects /Not a valid RSS/
it('extracts items with selectors and resolves relative links', ...) // listing.html: item 'article.post', title 'h2', link 'a@href' -> url starts with 'https://site.test/'
it('throws when selectors match nothing', ...)
```

Selector link syntax: `link` is a CSS selector with an optional `@attr` suffix (default `href`), and the same applies to `date` (default: text, or `datetime` when present).

- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(gather): rss and html fetchers`

---

### Task 5: Sanitize, story body rendering, article extraction

**Files:**
- Create: `server/util/sanitize.ts`, `server/gather/extract.ts`
- Test: `server/util/sanitize.test.ts`, `server/gather/extract.test.ts`

**Interfaces:**
- Produces:
  - `sanitizeHtml(html: string): string`: the allow-list from spec §5. Every `<a>` is forced to `rel="noopener noreferrer" target="_blank"`; schemes are `http`, `https` and `mailto` only.
  - `renderStoryBody(keyPoints: string[], whyItMatters: string): string` → `<h3>Key points</h3><ul><li>…</li></ul><h3>Why it matters</h3><p>…</p>`, with all text HTML-escaped.
  - `renderFallbackBody(items: RawItem[]): string` → `<p>` per snippet, prefixed with the site name in `<strong>`.
  - `extractArticleText(html: string, maxChars: number): string`: cheerio. Remove `script, style, nav, header, footer, aside, form`. Prefer `article`, then `main`, then `body`. Join the `p, li, h2, h3` text with `\n`, collapse whitespace, and truncate to `maxChars`.

- [ ] **Step 1: Write failing tests**

```ts
it('strips scripts, handlers and javascript urls', () => {
  const out = sanitizeHtml('<p onclick="x()">hi<script>alert(1)</script><a href="javascript:alert(1)">a</a><img src=x onerror=y></p>')
  expect(out).not.toMatch(/script|onclick|onerror|javascript:/)
})
expect(sanitizeHtml('<a href="https://a.dev">a</a>')).toContain('rel="noopener noreferrer"')
expect(renderStoryBody(['<b>x</b>'], 'y')).toContain('&lt;b&gt;x&lt;/b&gt;')
expect(extractArticleText('<nav>menu</nav><article><p>One</p><p>Two</p></article>', 100)).toBe('One\nTwo')
expect(extractArticleText('<body><p>' + 'a'.repeat(50) + '</p></body>', 10)).toHaveLength(10)
```

- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(server): html sanitization, story rendering, article extraction`

---

### Task 6: AI clients (Gemini + fallback) with budget

**Files:**
- Create: `server/gather/ai/budget.ts`, `server/gather/ai/fallback.ts`, `server/gather/ai/gemini.ts`
- Test: `server/gather/ai/ai.test.ts`

**Interfaces:**
- Consumes: `RawItem`, `Cluster`, `StorySummary`, `AiClient` (Task 3); `clusterByTitle`, `matchExisting` (Task 3).
- Produces:
  - `class AiBudget { constructor(maxCalls: number, perMinute = 8, now = Date.now, sleep = (ms)=>Promise); get remaining(): number; get exhausted(): boolean; markQuotaExhausted(): void; take(): Promise<boolean> }`. `take` waits as needed to respect `perMinute`; it returns false once `maxCalls` is reached or quota is exhausted.
  - `class FallbackAiClient implements AiClient`, `mode = 'fallback'`:
    - Triage: `clusterByTitle` + `matchExisting` against the first item's title.
    - Relevance = 5, +1 if the cluster has ≥ 2 items, +1 if any title matches `/\b(release|released|v?\d+\.\d+|launch|stable|deprecat|security|cve)\b/i` (capped at 10).
    - Tags = the union of `defaultTags[sourceId]`.
    - `summarize` returns `[]` (the pipeline treats missing summaries as fallback posts).
  - `class GeminiAiClient implements AiClient`, `mode = 'gemini'`:
    - Constructor: `constructor(opts: { apiKey: string; model: string; budget: AiBudget; generate?: GenerateFn })`.
    - `GenerateFn = (req: { model: string; contents: string; config: { responseMimeType: 'application/json'; responseSchema: object; systemInstruction: string } }) => Promise<{ text: string }>`. The default wraps `new GoogleGenAI({apiKey}).models.generateContent`.
    - `triage`: one call per ≤ 40 items. The response is validated with zod (`{ clusters: [{ itemIds: string[], existingPostId?: string, relevance: number 0-10, tags: string[] }] }`). Item ids that aren't in the batch are removed, clusters left empty are dropped, and an `existingPostId` that isn't in `recent` is removed. Items that end up in no cluster go through fallback clustering. On invalid JSON, a thrown error or a refused budget, that batch delegates to `FallbackAiClient.triage`.
    - `summarize`: one call per ≤ 5 stories. Results are validated with zod; an entry with an unknown `clusterId` is dropped. Errors return `[]` for that chunk.
    - Retries: up to 3 with exponential backoff (1 s, 2 s, 4 s) on status 429/5xx. A 429 whose message contains `PerDay` or `daily` calls `budget.markQuotaExhausted()` and is not retried.
    - System instructions (exact intent): triage is "You are an editor for a developer news digest. Group items about the same news. Score relevance to working software developers 0–10 (releases, breaking changes, security, notable tooling = high; marketing, hiring, opinion fluff = low). Use short lowercase tags." Summarize is "Write a neutral, factual summary for developers. tldr ≤ 2 sentences. 3–5 key points. whyItMatters 1–3 sentences. No hype."

- [ ] **Step 1: Write failing tests** (inject a fake `generate`; fake `sleep`/`now` for the budget)

```ts
it('budget stops after maxCalls', ...)            // new AiBudget(2) -> take() true,true,false
it('budget waits to respect perMinute', ...)      // perMinute=2: third take() sleeps ~60000ms (fake sleep records ms)
it('fallback clusters similar titles and scores releases higher', ...)
it('gemini triage returns validated clusters', ...)
it('rejects unknown item ids', ...)               // fake returns itemIds ['i0','zzz'] -> cluster has ['i0']
it('falls back on invalid JSON', ...)             // fake returns 'not json' -> result equals FallbackAiClient output
it('marks quota exhausted on daily 429 and stops calling', ...)  // fake throws {status:429, message:'...PerDay...'} -> budget.exhausted true, generate called once
it('summarize chunks by 5 and drops unknown cluster ids', ...)   // 7 stories -> generate called twice
```

- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(gather): gemini and fallback AI clients with free-tier budget`

---

### Task 7: Gather pipeline

**Files:**
- Create: `server/gather/pipeline.ts`
- Test: `server/gather/pipeline.test.ts`

**Interfaces:**
- Consumes: `JsonStore` (Task 2), `fetchSource`, `HttpGet` (Task 4), `normalizeUrl` (Task 3), `extractArticleText`, `renderStoryBody`, `renderFallbackBody`, `sanitizeHtml` (Task 5), `AiClient`, `AiBudget` (Task 6), `uniqueSlug`, `newId` (Task 2).
- Produces:
  - `class GatherService { constructor(deps: { store: JsonStore; http: HttpGet; makeAi: (budget: AiBudget) => AiClient; now?: () => Date }); isRunning(): string | null; start(trigger: Run['trigger']): { id: string } | { conflict: string } /* fire-and-forget */; runOnce(trigger): Promise<Run> /* awaited, used by tests and start() */ }`
  - Run flow per spec §4:
    1. Create the `Run` (`running`) and persist it.
    2. Fetch enabled sources with concurrency 4; update `lastFetchedAt`, `lastError` and `lastItemCount` on each source.
    3. Assign ids `i0…`, drop items whose `normalizeUrl` is in `seen` or that are older than `maxItemAgeHours`, and also drop duplicate URLs within the run.
    4. `ai.triage(fresh, recentPosts7d, defaultTagsBySource)`.
    5. Clusters with `existingPostId` → append new `PostSource`s (deduplicated by normalized URL) and bump `updatedAt` (`stats.merged`).
    6. Clusters below the threshold → `stats.skipped`.
    7. Sort the remaining clusters by relevance desc and fetch article text for ≤ 3 links each (failures are ignored and the snippet is used).
    8. `ai.summarize`, then create posts. Posts without a summary use fallback content with `aiPending: true`.
    9. Add all fetched normalized URLs to `seen`, prune `seen` older than 60 days and runs beyond 50.
    10. Set the status: `failed` if every source errored, `partial` if any did, else `success`.
  - `run.log` gets one human-readable line per stage (e.g. `Fetched 12 sources: 143 items (2 failed)`).
  - The whole run is wrapped in try/catch: an unexpected error sets `failed` with the message and always clears the running flag.

- [ ] **Step 1: Write failing tests** (temp-dir store; fake `http` keyed by URL; scripted fake `AiClient`)

```ts
it('creates one post per cluster with all source links', ...)  // 2 sources same story -> 1 post, sources.length 2, status published, tags from ai
it('merges into an existing recent post instead of duplicating', ...) // existing post p1 + cluster.existingPostId 'p1' -> posts.length unchanged, p1.sources +1, stats.merged 1
it('skips items already seen on a second run', ...)            // run twice -> second run stats.fresh 0, no new posts
it('skips clusters below relevance threshold', ...)
it('creates fallback post with aiPending when summary missing', ...)
it('marks run partial when one source throws', ...)            // one source http throws -> status 'partial', source.lastError set, other posts created
it('marks run failed when every source fails', ...)
it('refuses a second concurrent run', ...)                     // start() twice synchronously -> second returns {conflict: firstId}
it('ignores items older than maxItemAgeHours', ...)
```

- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(gather): pipeline with merge, budget-aware summaries and run log`

---

### Task 8: Seed sources and scheduler

**Files:**
- Create: `server/store/seed.ts`, `server/gather/scheduler.ts`
- Test: `server/gather/scheduler.test.ts`, `server/store/seed.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_SOURCES: Omit<Source,'id'>[]`, all `type: 'rss'`, enabled, with `defaultTags`:
    - Angular `https://blog.angular.dev/feed` [angular]
    - React `https://react.dev/rss.xml` [react]
    - Next.js `https://nextjs.org/feed.xml` [nextjs, react]
    - Node.js `https://nodejs.org/en/feed/blog.xml` [node]
    - TypeScript `https://devblogs.microsoft.com/typescript/feed/` [typescript]
    - GitHub Changelog `https://github.blog/changelog/feed/` [github]
    - Chrome for Developers `https://developer.chrome.com/static/blog/feed.xml` [chrome, web]
    - V8 `https://v8.dev/blog.atom` [javascript]
    - MDN `https://developer.mozilla.org/en-US/blog/rss.xml` [web]
    - Deno `https://deno.com/feed` [deno]
    - Bun `https://bun.sh/rss.xml` [bun]
    - Hacker News `https://hnrss.org/frontpage?points=200` [hn]
  - `createInitialDb(): Db`: empty collections, seeded sources, default settings.
  - `ensureSeed(store)`: if `sources` is empty **and** the DB was just created, insert the defaults (never re-seed after the user deletes sources).
  - `shouldCatchUp(lastRunStartedAt: string | undefined, now: Date, cron: string): boolean`: true when there was no run, or the last run started > 24 h ago and today's scheduled time has passed. Uses `node-cron`'s parsing for hour/minute fields (support the `m h * * *` form; other forms → false).
  - `startScheduler(cron: string, service: GatherService, store: JsonStore): { nextRunAt(): Date | null; stop(): void }`: `node-cron` schedule that calls `service.start('cron')` (a conflict is logged and skipped). Runs the catch-up check once on start.

- [ ] **Step 1: Write failing tests**

```ts
expect(shouldCatchUp(undefined, new Date('2026-10-17T09:00'), '0 4 * * *')).toBe(true)
expect(shouldCatchUp('2026-10-17T04:00:00', new Date('2026-10-17T09:00'), '0 4 * * *')).toBe(false)
expect(shouldCatchUp('2026-10-15T04:00:00', new Date('2026-10-17T03:00'), '0 4 * * *')).toBe(false) // before today's slot
expect(shouldCatchUp('2026-10-15T04:00:00', new Date('2026-10-17T05:00'), '0 4 * * *')).toBe(true)
expect(createInitialDb().sources).toHaveLength(12)
```

- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS
- [ ] **Step 5: Verify feed URLs live** with `npx tsx -e` and a short script: call `fetchSource` for each default, print the item count or error. Replace any failing URL with the site's current feed (check its `<link rel="alternate" type="application/rss+xml">`) or remove it, and record the change in the commit message.
- [ ] **Step 6: Commit** `feat(server): default sources, scheduler and catch-up`

---

### Task 9: HTTP API (public, auth, admin) and boot

**Files:**
- Create: `server/api/feed.ts`, `public.ts`, `auth.ts`, `admin-posts.ts`, `admin-sources.ts`, `admin-runs.ts`, `server/app.ts`, `server/index.ts`
- Test: `server/api/feed.test.ts`, `server/api/api.test.ts` (supertest against `createApp`)

**Interfaces:**
- Consumes: `JsonStore`, `Config`, `GatherService`, `sanitizeHtml`, `uniqueSlug`, `fetchSource`, scheduler `nextRunAt`.
- Produces:
  - `groupByDay(posts: Post[], opts: { days: number; before?: string; tag?: string; q?: string; tz?: string }): FeedResponse`. Published only, sorted by `publishedAt` desc, grouped by local `YYYY-MM-DD`. Returns at most `days` groups dated strictly before `before`; `nextBefore` = the last returned date when older posts exist. `q` matches title/tldr/tags case-insensitively.
  - `createApp(deps: { config: Config; store: JsonStore; gather: GatherService; scheduler: { nextRunAt(): Date | null } }): Express`. Routes exactly as spec §5. In production it also serves `dist/keepMeUpdated/browser` static files with an SPA fallback for non-`/api` GETs.
  - Session: cookie `kmu_session` = `base64url(JSON{sub,exp})` + `.` + HMAC-SHA256(secret). It is HttpOnly, `SameSite=Strict`, `Secure` when `isProd`, and lasts 7 days. Credentials are compared with `crypto.timingSafeEqual` on SHA-256 digests. `express-rate-limit` on login: 5/min.
  - `requireAdmin` middleware → `401 { error: 'Sign in required' }`.
  - Every body is validated with zod → `400 { error: <first issue message> }`. Unknown id → `404 { error: 'Not found' }`.
  - Admin post create/update: `bodyHtml` goes through `sanitizeHtml`; the slug comes from the body or `uniqueSlug(title)`. A slug already used by another post → `409 { error: 'That slug is already used' }`. `publishedAt` is set the first time the status becomes `published`.
  - `POST /api/admin/posts/:id/resummarize`: `409` when Gemini isn't configured; otherwise it re-runs extract + summarize for that post's links through a fresh `GeminiAiClient` (budget 2).
  - `POST /api/admin/sources/test`: runs `fetchSource` on the body config and returns `{ items: first 10 }` or `422 { error }`.
  - `index.ts`: `dotenv/config` → `loadConfig` → `JsonStore.open(path.join(dataDir,'db.json'), createInitialDb)` → `GatherService` with `makeAi`: a `GeminiAiClient` when the key is set, else a `FallbackAiClient` → `startScheduler` → `listen`, then log the URL and the AI mode.

- [ ] **Step 1: Write failing tests**

```ts
// feed.test.ts
it('groups published posts by day, newest first, excluding drafts', ...)
it('paginates with before and returns nextBefore', ...)  // 9 days of posts, days=7 -> 7 groups, nextBefore = 7th date; second page -> 2 groups, no nextBefore
it('filters by tag and q', ...)
// api.test.ts
it('GET /api/posts/:slug 404s for drafts', ...)
it('admin routes 401 without session', ...)
it('login with wrong password 401, right password sets HttpOnly cookie', ...)
it('rejects tampered session cookie', ...)
it('creates, updates (sanitized), and deletes a post', ...)  // bodyHtml with <script> stored without it
it('POST /api/admin/posts 409 on duplicate slug', ...)
it('POST /api/admin/runs returns 202 then 409 while running', ...) // gather fake with isRunning
it('POST /api/admin/sources/test returns parsed items', ...)
```

- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS
- [ ] **Step 5: Manual boot check.** Run `npm start` (with `.env` copied from `.env.example`). Then:
  - `curl localhost:3000/api/posts` → `{"days":[]}`.
  - `curl localhost:3000/api/tags` → `[]`.
  - `data/db.json` exists with 12 sources.
- [ ] **Step 6: Commit** `feat(server): public, auth and admin API`

---

### Task 10: Frontend foundation (tokens, theme, shell, API layer)

Load the `frontend-design:frontend-design` skill and read `design-system/keepmeupdated/MASTER.md`. To create that file, run the UI/UX Pro Max `--design-system --persist --output-dir .` command from the brainstorm, then edit its palette and typography to match the spec tokens. Do this before styling.

**Files:**
- Create: `src/styles.css` (rewrite), `src/app/core/api.ts`, `theme.service.ts`, `prefs.ts`, `src/app/public/masthead/masthead.ts`
- Modify: `src/index.html` (fonts preconnect + link, `<meta name="color-scheme" content="light dark">`, title), `src/app/app.config.ts`, `src/app/app.ts`, `src/app/app.routes.ts`
- Test: `src/app/core/theme.service.spec.ts`

**Interfaces:**
- Produces:
  - CSS custom properties from the spec §6 table on `:root`, with dark values under `@media (prefers-color-scheme: dark) { :root:not([data-theme=light]) {...} }` and `:root[data-theme=dark]`.
  - Type tokens: `--font-head: 'Newsreader', Georgia, serif`, `--font-body: 'Atkinson Hyperlegible', system-ui, sans-serif`, `--font-mono: 'JetBrains Mono', ui-monospace, monospace`.
  - Spacing scale `--s-1…--s-8` (4, 8, 12, 16, 24, 32, 48, 64 px), `--radius: 6px`, `--measure: 68ch`.
  - Utilities `.visually-hidden`, `.mono`, `.tag`, `:focus-visible` ring (2px `--accent`, offset 2px), and the `prefers-reduced-motion` reset.
  - `prefs.ts`: `readPref(key: string): string | null`, `writePref(key: string, v: string): void` (try/catch around localStorage).
  - `ThemeService { readonly mode: Signal<'system'|'light'|'dark'>; cycle(): void }`: applies `data-theme` on `<html>` (removed for system) and persists to the `kmu.theme` pref.
  - `api.ts`: `feedUrl(params) → string`, `postUrl(slug)`, `tagsUrl()`, plus `AdminApi` (injectable, HttpClient methods returning Observables) for posts, sources, runs, status and auth, all typed with `shared/models.ts`.
  - `app.config.ts`: `provideZonelessChangeDetection()` if not default, `provideRouter(routes, withViewTransitions(), withComponentInputBinding())`, `provideHttpClient(withFetch(), withInterceptors([credentialsInterceptor]))`.
  - Routes:
    - `''` → Home
    - `'p/:slug'` → PostPage
    - `'admin'` → `loadChildren` to `admin.routes`
    - `'**'` → NotFound
    - Public pages render inside a layout with the Masthead.
  - Masthead: the wordmark "keepMeUpdated" in Newsreader (the "Updated" part in the accent color), the full date in mono, and a theme toggle button (lucide `sun`/`moon`/`monitor`, with an `aria-label` naming the next mode).

- [ ] **Step 1: Failing test:** `ThemeService.cycle()` goes system → light → dark → system, sets `document.documentElement.dataset.theme` accordingly and writes `kmu.theme`.
- [ ] **Step 2:** `npx ng test --watch=false` → FAIL. **Step 3:** implement. **Step 4:** PASS, and `npx ng build` succeeds.
- [ ] **Step 5: Contrast check.** Write a throwaway node one-liner computing the WCAG ratios for ink, ink-soft and ink-muted on paper and on paper-raised, plus accent on paper, in both themes. All must be ≥ 4.5. Adjust only `--ink-muted` or `--accent` if one fails, and note the change in the commit.
- [ ] **Step 6: Commit** `feat(web): design tokens, theme, shell and api layer`

---

### Task 11: Home page (daily edition + compact)

**Files:**
- Create: `src/app/public/feed-utils.ts`, `home/home.ts`, `day-section/day-section.ts`, `post-row/post-row.ts` (each with co-located `.html`/`.css`)
- Test: `src/app/public/feed-utils.spec.ts`, `home/home.spec.ts`

**Interfaces:**
- Consumes: `FeedResponse`, `DayGroup`, `PostSummary`; `feedUrl`, `tagsUrl`; `readPref`/`writePref`.
- Produces:
  - `pickLead(posts: PostSummary[]): { lead: PostSummary | null; rest: PostSummary[] }`: highest relevance, ties broken by newest; `rest` keeps the original order.
  - `formatDay(date: string, today: Date): string` → `'Today'`, `'Yesterday'`, else e.g. `'Thursday, 15 October'`.
  - `Home`:
    - Signals `q`, `tag`, `view: 'edition'|'compact'` (from the `kmu.view` pref) and `pages: FeedResponse[]`.
    - The first page loads with `httpResource(() => feedUrl({days:7, tag: tag(), q: debouncedQ()}))`, with `q` debounced 300 ms.
    - "Load older days" fetches `before = last nextBefore` and appends.
    - Tag chips come from `/api/tags` (top 12 by count, plus an "All" chip). Chips are `button`s with `aria-pressed`.
    - The view toggle is a two-option segmented control (`role="radiogroup"`).
    - Designed states: loading skeleton (3 day blocks with fixed heights, no layout shift), empty ("No updates yet", body "The next gather runs at 04:00. You can also run it from the admin panel.", for an unfiltered empty feed; "Nothing matches that filter" with a "Clear filters" button otherwise), and error with a retry.
  - `DaySection` (`input.required<DayGroup>()`, `input<'edition'|'compact'>()`): the heading `formatDay` with an `<hr>` rule.
    - Edition: the lead is rendered large (Newsreader ~2rem, TL;DR, tags, source count, "AI summary pending" pill if `aiPending`), then `PostRow`s.
    - Compact: one line each (time in mono, title, first tag, source count).
  - `PostRow`: the whole row is a link to `/p/:slug`, with hover/focus states.
  - Layout: max width 1100px. On ≥ 1024px the edition puts the lead on the left (≈ 60%) and the rows on the right. On mobile everything stacks with 16px gutters.

- [ ] **Step 1: Failing tests**

```ts
expect(pickLead([a(rel 5), b(rel 8), c(rel 8, newer)]).lead).toBe(c)
expect(pickLead([]).lead).toBeNull()
expect(formatDay('2026-10-17', new Date('2026-10-17T10:00'))).toBe('Today')
expect(formatDay('2026-10-15', new Date('2026-10-17T10:00'))).toBe('Thursday, 15 October')
// home.spec: with HttpTestingController -> flush FeedResponse with 2 days -> 2 day sections rendered;
// clicking compact toggle writes pref 'kmu.view'='compact' and renders .row--compact
```

- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(web): daily edition home with compact view, filters and search`

---

### Task 12: Post page and 404

**Files:**
- Create: `src/app/public/post-page/post-page.ts` (+html/css), `not-found/not-found.ts`
- Test: `post-page/post-page.spec.ts`

**Interfaces:**
- Consumes: `Post`, `postUrl(slug)`.
- Produces:
  - `PostPage` (`slug = input.required<string>()` via component input binding): `httpResource<Post>(() => postUrl(this.slug()))`.
  - Layout, single column at `--measure`:
    1. Back link "All updates".
    2. Tags.
    3. h1 (Newsreader, clamp 2–3rem).
    4. Meta line: date (mono) · "N sources".
    5. TL;DR box (`--highlight` background, left 3px accent rule with radius 0, label "TL;DR").
    6. `bodyHtml` via `[innerHTML]` (already sanitized server-side; Angular's sanitizer stays on), with prose styles for h3/ul/p/a/code/pre/blockquote/img.
    7. A "Read the original" section: a list of sources showing the favicon (`https://icons.duckduckgo.com/ip3/<host>.ico`, `alt=""`, 16px, lazy), the site name, the article title and a lucide `external-link` icon. Links open in a new tab with `rel="noopener noreferrer"`.
    8. Footer note: "Summary written by AI from the sources above. Check the originals for details." When `aiPending`: "AI summary pending — showing the sources' own descriptions."
  - Sets `document.title` to `<title> · keepMeUpdated`.
  - A 404 response → renders NotFound inline.
  - NotFound: a Newsreader headline "This page isn't in any edition", with a link to "Today's edition".

- [ ] **Step 1: Failing test:** flush a Post with 3 sources → 3 `a[target=_blank][rel~=noopener]` links in `.originals`, and the TL;DR text is shown. Flushing a 404 shows the NotFound headline.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(web): post page with sources and 404`

---

### Task 13: Admin auth, shell and posts list

**Files:**
- Create: `src/app/core/auth.ts`, `src/app/admin/admin.routes.ts`, `admin-shell/`, `login/`, `posts-list/`
- Test: `src/app/core/auth.spec.ts`, `admin/posts-list/posts-list.spec.ts`

**Interfaces:**
- Consumes: `AdminApi` (Task 10).
- Produces:
  - `AuthService { readonly user: Signal<{email:string} | null | undefined> /* undefined = unknown */; check(): Promise<boolean>; login(email, password): Promise<void>; logout(): Promise<void> }`.
  - `authGuard: CanActivateFn`: `await check()`, else `router.createUrlTree(['/admin/login'], { queryParams: { next: state.url } })`.
  - `credentialsInterceptor`: adds `withCredentials: true` for `/api/` requests. On a 401 from `/api/admin/` it navigates to the login page.
  - `admin.routes`: `login` (public); `''` with `canActivate: [authGuard]` and the AdminShell layout, children `''` → PostsList, `posts/new` and `posts/:id` → PostEditor (`loadComponent`), `sources`, `runs`.
  - AdminShell: a side nav (Posts, Sources, Runs, View site ↗, Sign out) that collapses to a top bar under 768px. It uses the same tokens and a slightly denser 15px UI type.
  - Login: labeled email/password fields, inline error "Email or password is wrong" on 401, and a "Too many attempts. Wait a minute and try again." message on 429. Submit button "Sign in". Redirects to `next` or `/admin`.
  - PostsList:
    - A table with title (link to edit), a status pill (published = accent wash, draft = neutral, hidden = muted), origin, source count and updated date.
    - Filters: search input, status select.
    - Row actions: Edit, Publish/Unpublish, Delete (confirm via a native `<dialog>` with "Delete post" / "Cancel").
    - A "New post" primary button.
    - Empty state.

- [ ] **Step 1: Failing tests:** `authGuard` returns a UrlTree to `/admin/login?next=%2Fadmin%2Fsources` when `check()` resolves false, and `true` when it resolves true. PostsList renders a row per post from a flushed list, and confirming delete calls `DELETE /api/admin/posts/:id`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(admin): auth, shell and posts list`

---

### Task 14: Post editor with Tiptap

**Files:**
- Create: `src/app/admin/rich-editor/rich-editor.ts` (+css), `post-editor/post-editor.ts` (+html/css)
- Modify: `package.json` (Tiptap deps)
- Test: `post-editor/post-editor.spec.ts`

**Interfaces:**
- Consumes: `AdminApi`, `Post`, `PostSource`, `AdminStatus`.
- Produces:
  - `RichEditor`: `value = model<string>('')` (HTML) and `placeholder = input('Write the story…')`. It creates the Tiptap `Editor` in `afterNextRender` with StarterKit (headings 2–4), Link (`openOnClick: false`, autolink) and Image, and destroys it on destroy.
    - Toolbar buttons are lucide icons with `aria-label` and `aria-pressed` state: bold, italic, h2, h3, bullet list, ordered list, blockquote, code block, link (prompt for URL; an empty URL unsets the link), image (prompt for URL), undo, redo, clear formatting.
    - `onUpdate` sets `value`.
    - External `value` changes (on load) call `setContent` without emitting.
  - `PostEditor`: route `posts/new` or `posts/:id`. It uses Angular reactive forms (typed `FormGroup`):
    - Fields: `title` (required), `slug` (auto from title until edited by hand), `tldr` (required, ≤ 400), `tags` (chip input: Enter/comma adds, Backspace removes the last chip, lowercased and deduplicated), `status` (select), `sources` (FormArray of {siteName, url (required, http/https), title}) with add/remove, and `bodyHtml` bound to RichEditor.
    - The editor is wrapped in `@defer (on idle)` with a skeleton placeholder.
    - Actions: "Save" (POST/PUT → toast "Saved" → navigate to the edit URL for new posts), "Cancel", "Re-summarize with AI" (only when `status.geminiConfigured` and the post has sources; confirms that it overwrites TL;DR and body), and "View" (opens `/p/:slug` when published).
    - A server 400/409 error appears next to the relevant field (a slug conflict appears on the slug field).
    - A `canDeactivate` guard asks for confirmation when the form is dirty.

- [ ] **Step 1: Failing tests:**
  - Typing a title fills the slug.
  - Editing the slug manually stops auto-fill.
  - Adding tags `"Angular, signals"` gives `['angular','signals']`.
  - Saving a new post POSTs a body that contains `bodyHtml` and the sources.
  - A 409 response shows "That slug is already used" under the slug field.
- [ ] **Step 2:** FAIL → **Step 3:** `npm i @tiptap/core@3 @tiptap/starter-kit@3 @tiptap/extension-link@3 @tiptap/extension-image@3 @tiptap/extension-placeholder@3`, then implement. **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(admin): post editor with tiptap rich text`

---

### Task 15: Admin sources and runs pages

**Files:**
- Create: `src/app/admin/sources/sources.ts` (+html/css), `runs/runs.ts` (+html/css)
- Test: `sources/sources.spec.ts`, `runs/runs.spec.ts`

**Interfaces:**
- Consumes: `AdminApi`, `Source`, `Run`, `AdminStatus`.
- Produces:
  - Sources:
    - A list showing name, type badge, an enabled switch (`role="switch"`, toggling PUTs immediately), last fetched (relative), last item count and a `lastError` (danger text, truncated with a title tooltip).
    - Edit or "Add source" opens a side drawer (`<dialog>` styled as a drawer) with a form: name, site URL, type (RSS/HTML radio), feed/page URL, default tags, and selector fields shown only for HTML (item, title, link, date, summary, with helper text "CSS selector; add @attr to read an attribute, e.g. a@href").
    - "Test fetch" shows a preview list of the first 10 items or the error.
    - Save and Delete (with confirm).
  - Runs:
    - A status card: AI mode ("Gemini (gemini-flash-latest)" or "Fallback — add GEMINI_API_KEY to .env") and the next scheduled run time.
    - A "Run gather now" primary button. While a run is going the button shows a spinner and "Gathering…", and the page polls `GET /runs/:id` every 2000 ms (an `interval` signal effect, cleaned up on destroy) until the status isn't `running`, then shows a toast with stats.
    - History: a list showing trigger, start, duration, a status pill and stats. Rows expand (`<details>`) to show the log lines (mono) and errors.

- [ ] **Step 1: Failing tests:**
  - Selector fields appear only when the type is HTML.
  - "Test fetch" posts the form value to `/api/admin/sources/test` and renders the returned titles.
  - Runs: clicking "Run gather now" posts to `/api/admin/runs`. Polling stops after a flushed run with `status: 'success'` (use fake timers).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS
- [ ] **Step 5: Commit** `feat(admin): sources management and gather runs`

---

### Task 16: End-to-end verification and README

**Files:**
- Create: `README.md` (setup, `.env`, scripts, how to add a Gemini key, how sources/selectors work, where data lives, how to change admin credentials), `.claude/launch.json` (`dev` config: `npm run dev`, port 4200)

- [ ] **Step 1:** `npm run test:server && npx ng test --watch=false && npx ng build`: all green.
- [ ] **Step 2:** Start `npm run dev` through the preview tool. Sign in to `/admin` with the `.env` credentials, open Runs → "Run gather now" in fallback mode. Expected: the run ends `success` or `partial`, and posts exist.
- [ ] **Step 3: Browser checks:**
  - Home in edition and compact views, light and dark, at 375, 768 and 1440 widths: no horizontal scroll, and focus rings visible when tabbing.
  - A post page shows all source links.
  - Admin: create a manual post with formatting, an image and a link → publish → it appears on the home page. Edit it, unpublish it, delete it.
  - Add an HTML source and use "Test fetch".
- [ ] **Step 4:** Check against the UI/UX Pro Max pre-delivery checklist (no emoji icons, cursor pointer, hover transitions 150–300 ms, contrast 4.5:1, focus states, reduced motion, responsive breakpoints). Fix any misses.
- [ ] **Step 5: Commit** `docs: README and launch config; verified end to end`
