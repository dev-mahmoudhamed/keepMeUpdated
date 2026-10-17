import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { SiteConfig } from '../../../shared/models';
import { dataUrl } from './api';

export const GITHUB_API = 'https://api.github.com';
const TOKEN_KEY = 'kmu.gh.token';
const COMMIT_ATTEMPTS = 3;

export class TokenError extends Error {
  constructor(readonly reason: 'invalid' | 'no-access' | 'network') {
    super(reason);
    this.name = 'TokenError';
  }
}

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  createdAt: string;
  url: string;
  event: string;
  title: string;
}

function storage(kind: 'session' | 'local'): Storage | null {
  try {
    return kind === 'session' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

/** Where the admin's GitHub token lives: this tab only, or this device when "keep me signed in" is ticked. */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  get(): string | null {
    return storage('local')?.getItem(TOKEN_KEY) ?? storage('session')?.getItem(TOKEN_KEY) ?? null;
  }

  set(token: string, remember: boolean): void {
    this.clear();
    storage(remember ? 'local' : 'session')?.setItem(TOKEN_KEY, token);
  }

  clear(): void {
    storage('local')?.removeItem(TOKEN_KEY);
    storage('session')?.removeItem(TOKEN_KEY);
  }
}

/** Reads and writes this site's repository through the GitHub REST API (the admin panel's "backend"). */
@Injectable({ providedIn: 'root' })
export class RepoClient {
  private readonly http = inject(HttpClient);
  private readonly tokens = inject(TokenStore);
  private site?: Promise<SiteConfig>;

  config(): Promise<SiteConfig> {
    this.site ??= firstValueFrom(this.http.get<SiteConfig>(dataUrl('site.json'))).catch((err) => {
      this.site = undefined;
      throw err;
    });
    return this.site;
  }

  private headers(token = this.tokens.get(), accept = 'application/vnd.github+json'): HttpHeaders {
    return new HttpHeaders({
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });
  }

  private async repoUrl(path = ''): Promise<string> {
    const { repo } = await this.config();
    return `${GITHUB_API}/repos/${repo}${path}`;
  }

  /** Checks a token can push to the repository; returns the GitHub user. */
  async verifyToken(token: string): Promise<{ login: string }> {
    try {
      const repo = await firstValueFrom(
        this.http.get<{ permissions?: { push?: boolean } }>(await this.repoUrl(), { headers: this.headers(token) }),
      );
      if (!repo.permissions?.push) throw new TokenError('no-access');
      const user = await firstValueFrom(this.http.get<{ login: string }>(`${GITHUB_API}/user`, { headers: this.headers(token) }));
      return { login: user.login };
    } catch (err) {
      if (err instanceof TokenError) throw err;
      if (err instanceof HttpErrorResponse) {
        if (err.status === 401) throw new TokenError('invalid');
        if (err.status === 403 || err.status === 404) throw new TokenError('no-access');
      }
      throw new TokenError('network');
    }
  }

  private async headSha(): Promise<string> {
    const { branch } = await this.config();
    const ref = await firstValueFrom(
      this.http.get<{ object: { sha: string } }>(await this.repoUrl(`/git/ref/heads/${branch}`), { headers: this.headers() }),
    );
    return ref.object.sha;
  }

  private async fileAt(path: string, sha: string): Promise<{ text: string; exists: boolean }> {
    try {
      const text = await firstValueFrom(
        this.http.get(await this.repoUrl(`/contents/${path}?ref=${sha}`), {
          headers: this.headers(undefined, 'application/vnd.github.raw+json'),
          responseType: 'text',
        }),
      );
      return { text, exists: true };
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 404) return { text: '', exists: false };
      throw err;
    }
  }

  /** A file's text at the branch head ('' when it doesn't exist yet). */
  async readText(path: string): Promise<{ text: string; sha: string; exists: boolean }> {
    const sha = await this.headSha();
    return { sha, ...(await this.fileAt(path, sha)) };
  }

  /**
   * Commit a change to one file. `change` must be pure: if the branch moved meanwhile (e.g. a gather committed),
   * the file is re-read at the new head and `change` applied again.
   */
  async commitFile(path: string, change: (current: string) => string, message: string): Promise<void> {
    const { branch } = await this.config();
    for (let attempt = 1; attempt <= COMMIT_ATTEMPTS; attempt++) {
      const head = await this.headSha();
      const commit = await firstValueFrom(
        this.http.get<{ tree: { sha: string } }>(await this.repoUrl(`/git/commits/${head}`), { headers: this.headers() }),
      );
      const { text } = await this.fileAt(path, head);
      const next = change(text);
      if (next === text) return;

      const post = async <T>(p: string, body: unknown) =>
        firstValueFrom(this.http.post<T>(await this.repoUrl(p), body, { headers: this.headers() }));
      const blob = await post<{ sha: string }>('/git/blobs', { content: next, encoding: 'utf-8' });
      const tree = await post<{ sha: string }>('/git/trees', {
        base_tree: commit.tree.sha,
        tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }],
      });
      const created = await post<{ sha: string }>('/git/commits', { message, tree: tree.sha, parents: [head] });
      try {
        await firstValueFrom(
          this.http.patch(await this.repoUrl(`/git/refs/heads/${branch}`), { sha: created.sha, force: false }, { headers: this.headers() }),
        );
        return;
      } catch (err) {
        const moved = err instanceof HttpErrorResponse && (err.status === 409 || err.status === 422);
        if (!moved || attempt === COMMIT_ATTEMPTS) throw moved ? new Error('The repository kept changing. Try again.') : err;
      }
    }
  }

  async dispatchGather(inputs: { mode: string; post_id?: string }): Promise<void> {
    const { branch, gatherWorkflow } = await this.config();
    await firstValueFrom(
      this.http.post(await this.repoUrl(`/actions/workflows/${gatherWorkflow}/dispatches`), { ref: branch, inputs }, { headers: this.headers() }),
    );
  }

  async listGatherRuns(): Promise<WorkflowRun[]> {
    const { gatherWorkflow } = await this.config();
    type Raw = { id: number; status: string; conclusion: string | null; created_at: string; html_url: string; event: string; display_title: string };
    const res = await firstValueFrom(
      this.http.get<{ workflow_runs: Raw[] }>(await this.repoUrl(`/actions/workflows/${gatherWorkflow}/runs?per_page=10`), { headers: this.headers() }),
    );
    return res.workflow_runs.map((r) => ({
      id: r.id,
      status: r.status,
      conclusion: r.conclusion,
      createdAt: r.created_at,
      url: r.html_url,
      event: r.event,
      title: r.display_title,
    }));
  }
}
