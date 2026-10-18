import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { SiteConfig } from '../../../shared/models';
import { RepoClient } from './github';

const site: SiteConfig = { repo: 'me/kmu', branch: 'main', gatherWorkflow: 'gather.yml', schedule: '0 3 * * *' };
const API = '/api/github';

describe('RepoClient', () => {
  let http: HttpTestingController;
  let client: RepoClient;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(RepoClient);
  });

  afterEach(() => http.verify());

  /** Wait until the client has issued the next request matching `url`, then return it. */
  async function next(url: string, method = 'GET'): Promise<TestRequest> {
    for (let i = 0; i < 50; i++) {
      const found = http.match((r) => r.urlWithParams === url && r.method === method);
      if (found.length) return found[0];
      await Promise.resolve();
    }
    throw new Error(`no ${method} ${url}; open: ${http.match(() => true).map((r) => r.request.method + ' ' + r.request.urlWithParams).join(', ')}`);
  }

  async function flushConfig() {
    (await next('data/site.json')).flush(site);
  }

  it('reads a file as raw text at the branch head', async () => {
    const p = client.readText('content/posts.json');
    await flushConfig();
    (await next(`${API}/git/ref/heads/main`)).flush({ object: { sha: 'c1' } });
    const req = await next(`${API}/contents/content/posts.json?ref=c1`);
    expect(req.request.headers.get('Accept')).toBe('application/vnd.github.raw+json');
    expect(req.request.headers.get('Authorization')).toBeNull();
    req.flush('[1,2]');
    expect(await p).toEqual({ text: '[1,2]', sha: 'c1', exists: true });
  });

  it('treats a missing file as empty', async () => {
    const p = client.readText('content/posts.json');
    await flushConfig();
    (await next(`${API}/git/ref/heads/main`)).flush({ object: { sha: 'c1' } });
    (await next(`${API}/contents/content/posts.json?ref=c1`)).flush('nope', { status: 404, statusText: 'Not Found' });
    expect(await p).toEqual({ text: '', sha: 'c1', exists: false });
  });

  async function commitRound(head: string, current: string, patchStatus: number) {
    (await next(`${API}/git/ref/heads/main`)).flush({ object: { sha: head } });
    (await next(`${API}/git/commits/${head}`)).flush({ tree: { sha: `tree-${head}` } });
    (await next(`${API}/contents/sources.md?ref=${head}`)).flush(current);
    const blob = await next(`${API}/git/blobs`, 'POST');
    blob.flush({ sha: `blob-${head}` });
    const tree = await next(`${API}/git/trees`, 'POST');
    expect(tree.request.body).toEqual({ base_tree: `tree-${head}`, tree: [{ path: 'sources.md', mode: '100644', type: 'blob', sha: `blob-${head}` }] });
    tree.flush({ sha: `newtree-${head}` });
    const commit = await next(`${API}/git/commits`, 'POST');
    expect(commit.request.body).toEqual({ message: 'admin: update sources', tree: `newtree-${head}`, parents: [head] });
    commit.flush({ sha: `new-${head}` });
    const patch = await next(`${API}/git/refs/heads/main`, 'PATCH');
    expect(patch.request.body).toEqual({ sha: `new-${head}`, force: false });
    if (patchStatus === 200) patch.flush({});
    else patch.flush({ message: 'Update is not a fast forward' }, { status: patchStatus, statusText: 'Unprocessable' });
    return blob;
  }

  it('commits a change through blob, tree, commit and ref', async () => {
    const p = client.commitFile('sources.md', (t) => `${t}!`, 'admin: update sources');
    await flushConfig();
    const blob = await commitRound('c1', 'hello', 200);
    expect(blob.request.body).toEqual({ content: 'hello!', encoding: 'utf-8' });
    await expect(p).resolves.toBeUndefined();
  });

  it('retries on a moved branch and reapplies the change', async () => {
    const seen: string[] = [];
    const p = client.commitFile('sources.md', (t) => (seen.push(t), `${t}+mine`), 'admin: update sources');
    await flushConfig();
    await commitRound('c1', 'v1', 422);
    const blob = await commitRound('c2', 'v2-from-gather', 200);
    expect(seen).toEqual(['v1', 'v2-from-gather']);
    expect(blob.request.body.content).toBe('v2-from-gather+mine');
    await expect(p).resolves.toBeUndefined();
  });

  it('skips the commit when nothing changed', async () => {
    const p = client.commitFile('sources.md', (t) => t, 'admin: update sources');
    await flushConfig();
    (await next(`${API}/git/ref/heads/main`)).flush({ object: { sha: 'c1' } });
    (await next(`${API}/git/commits/c1`)).flush({ tree: { sha: 't1' } });
    (await next(`${API}/contents/sources.md?ref=c1`)).flush('same');
    await expect(p).resolves.toBeUndefined();
  });

  it('dispatches the gather workflow on the configured branch', async () => {
    const p = client.dispatchGather({ mode: 'resummarize', post_id: 'p1' });
    await flushConfig();
    const req = await next(`${API}/actions/workflows/gather.yml/dispatches`, 'POST');
    expect(req.request.body).toEqual({ ref: 'main', inputs: { mode: 'resummarize', post_id: 'p1' } });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await expect(p).resolves.toBeUndefined();
  });

  it('lists recent gather runs', async () => {
    const p = client.listGatherRuns();
    await flushConfig();
    (await next(`${API}/actions/workflows/gather.yml/runs?per_page=10`)).flush({
      workflow_runs: [{ id: 1, status: 'completed', conclusion: 'success', created_at: '2026-10-17T03:00:00Z', html_url: 'https://github.com/x', event: 'schedule', display_title: 'Gather news' }],
    });
    expect(await p).toEqual([
      { id: 1, status: 'completed', conclusion: 'success', createdAt: '2026-10-17T03:00:00Z', url: 'https://github.com/x', event: 'schedule', title: 'Gather news' },
    ]);
  });
});
