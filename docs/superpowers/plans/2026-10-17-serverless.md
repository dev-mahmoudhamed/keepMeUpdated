# keepMeUpdated Serverless Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Node server with GitHub Actions + a static GitHub Pages site. Keep 30 days of news in committed JSON files. Run the admin panel entirely through the GitHub API.

**Architecture:**
- `scripts/` holds the gather pipeline (logic unchanged) and two CLIs: `gather` and `build-data`. They read and write `content/*.json` and `sources.md`.
- Workflows run the CLIs, commit, and deploy to Pages.
- Angular reads static JSON for the public site. Admin pages go through a `RepoClient` built on the GitHub REST API, signed in with a fine-grained token.

**Tech Stack:** Node 24 LTS, Angular 22, tsx, Vitest, @google/genai, rss-parser, cheerio, sanitize-html, zod, Tiptap 3, GitHub Actions (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`).

**Spec:** `docs/superpowers/specs/2026-10-17-serverless-design.md`

## Global Constraints

- No HTTP server code, no `.env`, and no credentials in the repo. The only secret is `GEMINI_API_KEY` in Actions secrets.
- Retention is 30 days (`settings.retentionDays`, default 30). Runs are capped at 50.
- Cron is `0 3 * * *`. Workflow file names are `gather.yml` and `deploy.yml`.
- Canonical data lives in `content/posts.json` and `content/state.json`. Public data (`public/data/**`) is generated and git-ignored.
- Admin token storage: `sessionStorage` key `kmu.gh.token`, or `localStorage` with the same key when "keep me signed in" is ticked.
- Every GitHub API call sends `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`.
- All in-app links must be base-href safe: router links, or relative URLs only (no `href="/…"`).
- UI copy rules carry over from the original plan.

## Review Focus

1. **Admin save at the same moment as a gather commit.** The ref update is rejected, so the change must be reapplied on the new head without losing either side. → Task 6 test `retries on a moved branch and reapplies the change`.
2. **Expired or revoked token mid-session.** A 401 from GitHub must send the admin to the login page with a clear message, not an endless spinner. → Task 7 test `drops the token and redirects on 401`.
3. **Retention boundary.** A post exactly 30 days old stays; older is removed; drafts age by `createdAt`. → Task 1 test `prunes posts and seen links older than retentionDays`.
4. **Admin-entered HTML** (`<script>`, `onerror=`) committed raw to `content/posts.json` must never reach the public JSON unsanitized. → Task 3 test `sanitizes bodyHtml in public post files`.
5. **Deep links on GitHub Pages under `/keepMeUpdated/`** (refresh on `/p/slug`). → Task 4 `404.html` step, plus Task 5 test that `postUrl` is relative.

---

### Task 1: Restructure `server/` → `scripts/`, remove server code, content files + retention

**Files:**
- Move: `git mv server scripts`. Update `vitest.server.config.ts` (rename to `vitest.scripts.config.ts`, include `scripts/**/*.test.ts`) and `tsconfig.server.json` (rename to `tsconfig.scripts.json`, include `scripts`, `shared`).
- Delete:
  - `scripts/index.ts`, `scripts/app.ts`, `scripts/config.ts` (+ test);
  - `scripts/api/*` except `feed.ts` (moved in Task 2);
  - `scripts/gather/scheduler.ts` (+ test);
  - `scripts/store/json-store.ts` (+ test), `scripts/store/seed.ts` (+ test);
  - `proxy.conf.json`, `.env.example`, `.claude/launch.json` (recreated in Task 8).
- Create: `scripts/content/files.ts`, `scripts/content/memory-store.ts`
- Modify:
  - `scripts/gather/pipeline.ts`: depends on the `Store` interface instead of `JsonStore`.
  - `scripts/store/sources-file.ts`: becomes `scripts/content/sources-file.ts`, without the watcher.
  - `shared/models.ts`: `Settings.retentionDays`; new `ContentState`.
- Test: `scripts/content/files.test.ts`; existing pipeline tests adapted to `MemoryStore`.

**Interfaces:**
- Produces:
  - `interface Store { read(): Readonly<Db>; update<T>(fn: (db: Db) => T): Promise<T> }`. The pipeline already uses only these two methods.
  - `class MemoryStore implements Store { constructor(db: Db) }`: no persistence.
  - `ContentState = { version: 1; seen: Record<string,string>; runs: Run[]; settings: Settings }`.
  - `loadContent(root: string): Promise<Db>`:
    - reads `content/posts.json` (missing → `[]`) and `content/state.json` (missing → defaults);
    - reads `sources.md` through `parseSourcesMd`, and assigns each source a stable id = the first 12 hex chars of sha1(normalized feed URL);
    - invalid JSON → throws `"<file> is not valid JSON"`.
  - `saveContent(root: string, db: Db): Promise<{ changed: string[] }>`:
    - writes `posts.json` (2-space JSON, sorted newest first) and `state.json` atomically (tmp + rename);
    - only writes files whose text changed;
    - never writes `sources.md`, since the gather doesn't change sources. Source fetch history (`lastFetchedAt` / `lastError` / `lastItemCount`) moves into `state.sourceStatus: Record<sourceId, {...}>`.
  - `applyRetention(db: Db, now: Date): { removedPosts: number; removedSeen: number }`: cutoff = `now - retentionDays`. A post is removed when `(publishedAt ?? createdAt) < cutoff`; `seen` entries older than the cutoff are removed; `runs` are spliced to 50.

- [ ] Step 1: Write the failing tests in `files.test.ts`:
  - `loads defaults when content files are missing`;
  - `round-trips posts and state` (temp dir);
  - `only rewrites files whose content changed`;
  - `prunes posts and seen links older than retentionDays` (the exact 30-day boundary stays; a draft ages by `createdAt`);
  - `gives sources stable ids from their feed url`;
  - `throws on invalid JSON`.
- [ ] Step 2: Run `npm run test:scripts`. Expected: FAIL (module missing).
- [ ] Step 3: Implement the move, the deletions and the new modules. Adapt `pipeline.test.ts` to `MemoryStore`, and have the pipeline write source status into the db's sources (as today); `saveContent` maps it into `state.sourceStatus`.
- [ ] Step 4: Run `npm run test:scripts` and `npx tsc -p tsconfig.scripts.json`. Expected: PASS.
- [ ] Step 5: Remove the unused deps: `npm rm express cookie-parser express-rate-limit node-cron dotenv supertest @types/express @types/cookie-parser @types/supertest concurrently cross-env`.
- [ ] Step 6: Migrate the local data: a one-off `npx tsx` snippet converts `data/db.json` into `content/posts.json` and `content/state.json`. Then delete `data/` and `.env`.
- [ ] Step 7: Commit `refactor: replace server with file-based content and retention`.

### Task 2: Shared pure helpers (`shared/sources-md.ts`, `shared/feed.ts`)

**Files:**
- Move:
  - `parseSourcesMd`, `renderSourcesMd` and `syncSources` from `scripts/content/sources-file.ts` → `shared/sources-md.ts`;
  - `groupByDay`, `tagCounts` and `toSummary` from `scripts/api/feed.ts` → `shared/feed.ts`;
  - `normalizeUrl` → `shared/url.ts`, re-exported from `scripts/gather/dedupe.ts`.
- Tests: move `feed.test.ts` and the parse/render tests to `scripts/shared-tests/` (Vitest node env runs them).

**Interfaces:** the same signatures as today, with no Node-only APIs (no `node:*` imports).

- [ ] Step 1: Move the tests and point their imports at the new paths. Run them: FAIL.
- [ ] Step 2: Move the code. Run: PASS. `npx ng build` still passes, since the Angular side doesn't import these yet.
- [ ] Step 3: Commit `refactor: share sources-md and feed helpers with the browser`.

### Task 3: CLIs `gather` and `build-data`

**Files:**
- Create: `scripts/gather.ts`, `scripts/build-data.ts`, `scripts/cli/run-gather.ts` (testable core), `scripts/cli/build-public.ts` (testable core), `scripts/gather/resummarize.ts`.
- Tests: `scripts/cli/run-gather.test.ts`, `scripts/cli/build-public.test.ts`.

**Interfaces:**
- `runGather(opts: { root: string; mode: 'gather'|'resummarize'|'dry-run'; postId?: string; http: HttpGet; makeAi: (b: AiBudget) => AiClient; now?: () => Date; log: (l: string) => void }): Promise<{ summary: string; changed: string[] }>`:
  - **gather:** loadContent → applyRetention → `GatherService.runOnce('cron' | 'manual')`, where the trigger comes from `GITHUB_EVENT_NAME` (`schedule` → `cron`) → saveContent.
  - **resummarize:** `resummarizePost(db, postId, http, ai)` → saveContent.
  - **dry-run:** fetch every enabled source; summary = a markdown table of name | items | newest | error; nothing is saved.
  - In every mode, `summary` is markdown for `$GITHUB_STEP_SUMMARY`.
- `resummarizePost(db: Db, postId: string, http: HttpGet, ai: AiClient): Promise<'updated' | 'not-found' | 'no-sources' | 'no-summary'>`: the logic is moved from the deleted admin route.
- `buildPublic(opts: { root: string; outDir: string; repo: string; branch: string }): Promise<{ posts: number }>`:
  - writes `outDir/posts.json` (published only, newest first, `PostSummary[]` + `generatedAt`);
  - writes `outDir/p/<slug>.json` with `bodyHtml` passed through `sanitizeHtml`;
  - writes `outDir/site.json`;
  - empties `outDir` first.
- `scripts/gather.ts`: parses `--mode` and `--post`; uses Gemini when `GEMINI_API_KEY` is set, otherwise the fallback; appends the summary to `GITHUB_STEP_SUMMARY` if that is set; exits 1 when the run status is `failed`.
- `scripts/build-data.ts`: the repo comes from `GITHUB_REPOSITORY`, else is parsed from `git remote get-url origin` (`github.com[:/]owner/name(.git)`), else `"owner/keepMeUpdated"`.

- [ ] Step 1: Write the failing tests:
  - `gather mode prunes, gathers and saves` (mocked http/AI, temp root);
  - `dry-run reports per-source counts and writes nothing`;
  - `resummarize updates one post`;
  - `resummarize reports a missing post`;
  - `writes only published posts to the public index`;
  - `sanitizes bodyHtml in public post files`;
  - `writes site.json with the repo`;
  - `removes stale public files`.
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS, and tsc is clean.
- [ ] Step 5: Scripts in `package.json`:
  - `"gather": "tsx scripts/gather.ts"`, `"build:data": "tsx scripts/build-data.ts"`;
  - `"dev": "npm run build:data && ng serve"`, `"build": "npm run build:data && ng build"`;
  - `"test:scripts": "vitest run -c vitest.scripts.config.ts"`;
  - remove `start`.
  - Add `public/data/` to `.gitignore`.
- [ ] Step 6: Commit `feat(scripts): gather and build-data CLIs`.

### Task 4: GitHub workflows

**Files:** create `.github/workflows/gather.yml` and `.github/workflows/deploy.yml`. Test: `scripts/cli/workflows.test.ts` (parses the YAML with the `yaml` dev dependency and asserts its structure).

- **gather.yml:**
  - Triggers: `schedule: [{cron: '0 3 * * *'}]`, and `workflow_dispatch.inputs` `mode` (choice: gather, resummarize, dry-run; default gather) and `post_id` (string, optional).
  - `concurrency: { group: gather, cancel-in-progress: false }`.
  - The job `gather` has `permissions: contents: write`. Steps:
    - checkout (fetch-depth 0); setup-node with `node-version: 24`, `cache: npm`; `npm ci`;
    - `npm run gather -- --mode "${{ inputs.mode || 'gather' }}" --post "${{ inputs.post_id }}"`, with env `GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}`;
    - commit and push: `git add content` → skip if no staged changes → commit `"gather: <date> (<mode>)"` → up to 3 attempts of `git pull --rebase origin main && git push`.
  - The job `deploy` has `needs: gather`, `if: inputs.mode != 'dry-run'`, `uses: ./.github/workflows/deploy.yml`, and `permissions: pages: write, id-token: write, contents: read`.
- **deploy.yml:**
  - Triggers: `push` on main (paths-ignore: `docs/**`, `**/*.md` except `sources.md`), `workflow_dispatch`, `workflow_call`.
  - `concurrency: { group: pages, cancel-in-progress: true }`.
  - The `build` job: checkout (ref main, so a workflow_call picks up the gather commit); setup-node 24; `npm ci`; `npm run build:data`; `npx ng build --base-href "/${{ github.event.repository.name }}/"`; `cp dist/keepMeUpdated/browser/index.html dist/keepMeUpdated/browser/404.html`; `actions/upload-pages-artifact@v3` with path `dist/keepMeUpdated/browser`.
  - The `deploy` job: `environment: { name: github-pages, url: ${{ steps.d.outputs.page_url }} }`, `actions/deploy-pages@v4`.

- [ ] Step 1: Failing test `workflows.test.ts`: the gather cron is `0 3 * * *`; dispatch has the mode choices; gather has contents write; it calls `./.github/workflows/deploy.yml`; deploy has workflow_call and copies 404.html; no workflow references secrets other than `GEMINI_API_KEY` (and the implicit `GITHUB_TOKEN`).
- [ ] Step 2: FAIL → Step 3: write the YAML → Step 4: PASS.
- [ ] Step 5: Commit `ci: gather and pages deploy workflows`.

### Task 5: Public site on static data

**Files:**
- Modify:
  - `src/app/core/api.ts`: replace the HTTP endpoints with `dataUrl('posts.json')`, `postUrl(slug) = data/p/<slug>.json`, `siteUrl = data/site.json`. All relative.
  - `src/app/public/home/home.ts`: load the index once and compute the pages with `shared/feed.ts`.
  - `src/app/public/post-page/post-page.ts`: no logic change beyond the URL.
- Delete `credentialsInterceptor` usage (Task 7 replaces auth).
- Tests: update `home.spec.ts` (one request to `data/posts.json`; filters work without new requests; "Load older days" reveals more days with no request); update `post-page.spec.ts` (URL); add `api.spec.ts` with `postUrl is relative`.

**Interfaces:** `FeedIndex = { generatedAt: string; posts: PostSummary[] }` in `shared/models.ts`. Home holds `index = httpResource<FeedIndex>(() => 'data/posts.json')`, `daysShown = signal(7)`, and `feed = computed(() => groupByDay(posts, { days: daysShown(), tag, q }))`.

- [ ] Steps: failing specs → implement → `npx ng test` PASS → `npx ng build` → commit `feat(web): public site reads static data`.

### Task 6: GitHub repo client (browser)

**Files:** create `src/app/core/github.ts`, test `src/app/core/github.spec.ts`.

**Interfaces:**
- `RepoConfig = { repo: string; branch: string; gatherWorkflow: string; schedule: string }`, loaded from `data/site.json`.
- `@Injectable RepoClient`:
  - `config(): Promise<RepoConfig>` (cached);
  - `verifyToken(token): Promise<{ login: string } >`: `GET /repos/{repo}` must have `permissions.push`, then `GET /user`; throws `TokenError` with `reason: 'invalid' | 'no-access' | 'network'`;
  - `readText(path): Promise<{ text: string; sha: string /* commit sha of head */ }>`: `GET /repos/{repo}/contents/{path}?ref={branch}` with the raw Accept header, plus the head sha from `GET /repos/{repo}/git/ref/heads/{branch}`;
  - `commitFile(path, change: (current: string) => string, message): Promise<void>`:
    - read the head ref → read the file at that commit → `change(text)`;
    - `POST /git/blobs` (utf-8) → `POST /git/trees` with `base_tree` = the head tree → `POST /git/commits` → `PATCH /git/refs/heads/{branch}` with `force: false`;
    - on 409/422, restart from the head, up to 3 attempts;
    - an unchanged result skips the commit;
  - `dispatchGather(inputs: { mode: string; post_id?: string }): Promise<void>`: `POST /actions/workflows/{file}/dispatches` with `ref: branch`;
  - `listGatherRuns(): Promise<WorkflowRun[]>`: `GET /actions/workflows/{file}/runs?per_page=10`.
- The token comes from `TokenStore` (`get()`, `set(token, remember)`, `clear()`).

- [ ] Step 1: Failing tests with HttpTestingController:
  - `reads a file as raw text`;
  - `commits a change through blob, tree, commit and ref`;
  - `retries on a moved branch and reapplies the change` (the first PATCH returns 422 and the second succeeds; the change function gets the new text);
  - `skips the commit when nothing changed`;
  - `verifyToken rejects tokens without push access`;
  - `dispatches the gather workflow on the configured branch`.
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS → Step 5: commit `feat(admin): GitHub repo client`.

### Task 7: Token sign-in, login page redesign, guard

**Files:**
- Modify:
  - `src/app/core/auth.ts`: `AuthService` now uses `TokenStore` and `RepoClient.verifyToken`; `authGuard` is unchanged in shape; a new `githubErrorInterceptor` (a 401 from `api.github.com` → `auth.signedOut()` and navigate to login with `?expired=1`).
  - `src/app/admin/login/login.ts`: rewritten.
  - `app.config.ts`: register the interceptor.
- Tests: `auth.spec.ts` (`signs in with a token that can push`, `drops the token and redirects on 401`, `remembers the token only when asked`) and `login.spec.ts` (`shows why a token was rejected`).
- Login layout:
  - A centered panel (class `login-panel`, not `card`) with padding `var(--s-6)`, gap `var(--s-4)`, max-width 420px.
  - Wordmark, then h1 "Sign in to manage posts".
  - One field, "GitHub access token" (type password), with hint text.
  - A checkbox, "Keep me signed in on this device".
  - The primary button "Sign in".
  - A `<details>` "How to create a token" with 4 numbered steps (a real sequence) and a link to `https://github.com/settings/personal-access-tokens/new` (opens in a new tab).
  - Error copy:
    - invalid: "GitHub didn't accept this token. Check it was copied in full.";
    - no-access: "This token can't edit <repo>. Give it Contents and Actions read/write access to this repository.";
    - network: "Couldn't reach GitHub. Check your connection.";
    - expired: "Your token expired or was revoked. Sign in again."
- [ ] Steps: failing specs → implement → PASS → commit `feat(admin): sign in with a GitHub token; redesigned login`.

### Task 8: Admin pages on the repo

**Files:**
- Modify:
  - `posts-list.ts`, `post-editor.ts`: read `content/posts.json`; write through `commitFile` with pure changes from a new `src/app/admin/post-changes.ts` (`upsertPost`, `deletePost`, `setStatus`, `uniqueSlugIn`).
  - `sources.ts`: reads and writes `sources.md` via `shared/sources-md.ts`; "Test fetch" removed.
  - `runs.ts`: the status card (last run's AI mode from `content/state.json`, the next 03:00 UTC in local time), "Run gather now" and "Dry run" buttons, the live workflow runs list (status, conclusion, started, a link to `html_url`), and run history with logs from state.
  - Editor: re-summarize dispatches `mode=resummarize`.
- Delete the `AdminApi` class; `src/app/core/api.ts` keeps only the public URL helpers.
- Recreate `.claude/launch.json` with `dev` = `npm run dev`.
- Tests: `post-changes.spec.ts` (pure functions: unique slug, upsert keeps createdAt, sets publishedAt on first publish, delete); updated `posts-list.spec.ts`, `post-editor.spec.ts`, `sources.spec.ts`, `runs.spec.ts` against a fake `RepoClient`.
- After a commit, the toast reads "Saved. The site updates in about 2 minutes."
- [ ] Steps: failing specs → implement → PASS → `npx ng build` → commit `feat(admin): manage posts, sources and runs through GitHub`.

### Task 9: Docs, cleanup, verification

- README rewrite:
  - how it works;
  - the 4 setup steps (public repo, Pages source, `GEMINI_API_KEY` secret, token);
  - running locally (`npm run dev`, and `GEMINI_API_KEY=… npm run gather`);
  - `sources.md`; retention; and the fact that Git history keeps old file versions.
- Update the design system's MASTER note if paths changed.
- Verification:
  - `npm run test:scripts`, `npx ng test --watch=false` and `npm run build` are all green;
  - `npm run gather -- --mode dry-run` locally (live feeds);
  - `npm run gather` locally in fallback mode → content changes → `npm run build:data` → `ng serve` → the browser shows the posts and the admin login page renders (token sign-in can't be tested without the owner's token).
- Commit `docs: serverless setup`. The push is the owner's call.
