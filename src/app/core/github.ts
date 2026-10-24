import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { SiteConfig } from '../../../shared/models';
import { dataUrl } from './api';

/** The site's own API (a Netlify Function) that makes GitHub calls with the server's token for a signed-in admin. */
export const ADMIN_API = '/api/github';
const COMMIT_ATTEMPTS = 3;

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  createdAt: string;
  url: string;
  event: string;
  title: string;
}

/** Reads and writes this site's repository through GitHub's REST API, by way of the site's admin API. */
@Injectable({ providedIn: 'root' })
export class RepoClient {
  private readonly http = inject(HttpClient);
  private site?: Promise<SiteConfig>;

  config(): Promise<SiteConfig> {
    this.site ??= firstValueFrom(this.http.get<SiteConfig>(dataUrl('site.json'))).catch((err) => {
      this.site = undefined;
      throw err;
    });
    return this.site;
  }

  private headers(accept = 'application/vnd.github+json'): HttpHeaders {
    return new HttpHeaders({ Accept: accept });
  }

  private url(path: string): string {
    return `${ADMIN_API}${path}`;
  }

  private async headSha(): Promise<string> {
    const { branch } = await this.config();
    const ref = await firstValueFrom(
      this.http.get<{ object: { sha: string } }>(this.url(`/git/ref/heads/${branch}`), { headers: this.headers() }),
    );
    return ref.object.sha;
  }

  private async fileAt(path: string, sha: string): Promise<{ text: string; exists: boolean }> {
    try {
      const text = await firstValueFrom(
        this.http.get(this.url(`/contents/${path}?ref=${sha}`), {
          headers: this.headers('application/vnd.github.raw+json'),
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
        this.http.get<{ tree: { sha: string } }>(this.url(`/git/commits/${head}`), { headers: this.headers() }),
      );
      const { text } = await this.fileAt(path, head);
      const next = change(text);
      if (next === text) return;

      const post = async <T>(p: string, body: unknown) =>
        firstValueFrom(this.http.post<T>(this.url(p), body, { headers: this.headers() }));
      const blob = await post<{ sha: string }>('/git/blobs', { content: next, encoding: 'utf-8' });
      const tree = await post<{ sha: string }>('/git/trees', {
        base_tree: commit.tree.sha,
        tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }],
      });
      const created = await post<{ sha: string }>('/git/commits', { message, tree: tree.sha, parents: [head] });
      try {
        await firstValueFrom(
          this.http.patch(this.url(`/git/refs/heads/${branch}`), { sha: created.sha, force: false }, { headers: this.headers() }),
        );
        return;
      } catch (err) {
        const moved = err instanceof HttpErrorResponse && (err.status === 409 || err.status === 422);
        if (!moved || attempt === COMMIT_ATTEMPTS) throw moved ? new Error('The repository kept changing. Try again.') : err;
      }
    }
  }

  /** Starts the gather workflow (it listens for the "gather" repository_dispatch event). */
  async dispatchGather(payload: { mode: string; post_id?: string }): Promise<void> {
    await firstValueFrom(
      this.http.post(this.url('/dispatches'), { event_type: 'gather', client_payload: payload }, { headers: this.headers() }),
    );
  }

  async listGatherRuns(): Promise<WorkflowRun[]> {
    const { gatherWorkflow } = await this.config();
    type Raw = { id: number; status: string; conclusion: string | null; created_at: string; html_url: string; event: string; display_title: string };
    const res = await firstValueFrom(
      this.http.get<{ workflow_runs: Raw[] }>(this.url(`/actions/workflows/${gatherWorkflow}/runs?per_page=10`), { headers: this.headers() }),
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

/** A readable message for a failed GitHub call or commit. */
export function githubErrorText(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Couldn’t reach the server. Check your connection and try again.';
    if (err.status === 403) return 'GitHub refused this change. Check the site’s GitHub token has Contents write and Actions read access.';
    const message = (err.error as { message?: string } | null)?.message;
    if (err.status >= 500 && message) return message;
    return message ? `GitHub said: ${message}` : `GitHub returned an error (${err.status}). Try again.`;
  }
  return err instanceof Error ? err.message : 'Something went wrong. Try again.';
}

export const SAVED_MESSAGE = 'Saved. The site updates in about 2 minutes.';
