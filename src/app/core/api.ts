import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { AdminStatus, Post, PostStatus, Run, Source, SourceSelectors } from '../../../shared/models';

export interface FeedParams {
  days?: number;
  before?: string;
  tag?: string | null;
  q?: string | null;
}

export function feedUrl(params: FeedParams = {}): string {
  const qs = new URLSearchParams();
  qs.set('days', String(params.days ?? 7));
  if (params.before) qs.set('before', params.before);
  if (params.tag) qs.set('tag', params.tag);
  if (params.q?.trim()) qs.set('q', params.q.trim());
  return `/api/posts?${qs.toString()}`;
}

export const postUrl = (slug: string) => `/api/posts/${encodeURIComponent(slug)}`;
export const tagsUrl = () => '/api/tags';

/** What the admin sends when saving a post. */
export interface PostInput {
  title: string;
  slug?: string;
  tldr: string;
  bodyHtml: string;
  tags: string[];
  status: PostStatus;
  sources: { siteName: string; url: string; title: string; sourceId?: string; publishedAt?: string }[];
}

export interface SourceInput {
  name: string;
  siteUrl: string;
  type: 'rss' | 'html';
  feedUrl: string;
  selectors?: SourceSelectors;
  defaultTags: string[];
  enabled: boolean;
  /** Section in sources.md. */
  group?: string;
}

export interface PreviewItem {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);

  me(): Observable<{ email: string }> {
    return this.http.get<{ email: string }>('/api/auth/me');
  }
  login(email: string, password: string): Observable<void> {
    return this.http.post<void>('/api/auth/login', { email, password });
  }
  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {});
  }

  posts(filter: { status?: string; q?: string } = {}): Observable<Post[]> {
    const params: Record<string, string> = {};
    if (filter.status) params['status'] = filter.status;
    if (filter.q) params['q'] = filter.q;
    return this.http.get<Post[]>('/api/admin/posts', { params });
  }
  post(id: string): Observable<Post> {
    return this.http.get<Post>(`/api/admin/posts/${id}`);
  }
  createPost(body: PostInput): Observable<Post> {
    return this.http.post<Post>('/api/admin/posts', body);
  }
  updatePost(id: string, body: PostInput): Observable<Post> {
    return this.http.put<Post>(`/api/admin/posts/${id}`, body);
  }
  deletePost(id: string): Observable<void> {
    return this.http.delete<void>(`/api/admin/posts/${id}`);
  }
  resummarize(id: string): Observable<Post> {
    return this.http.post<Post>(`/api/admin/posts/${id}/resummarize`, {});
  }

  sources(): Observable<Source[]> {
    return this.http.get<Source[]>('/api/admin/sources');
  }
  createSource(body: SourceInput): Observable<Source> {
    return this.http.post<Source>('/api/admin/sources', body);
  }
  updateSource(id: string, body: SourceInput): Observable<Source> {
    return this.http.put<Source>(`/api/admin/sources/${id}`, body);
  }
  deleteSource(id: string): Observable<void> {
    return this.http.delete<void>(`/api/admin/sources/${id}`);
  }
  testSource(body: SourceInput): Observable<{ items: PreviewItem[] }> {
    return this.http.post<{ items: PreviewItem[] }>('/api/admin/sources/test', body);
  }

  runs(): Observable<Run[]> {
    return this.http.get<Run[]>('/api/admin/runs');
  }
  run(id: string): Observable<Run> {
    return this.http.get<Run>(`/api/admin/runs/${id}`);
  }
  startRun(): Observable<{ id: string }> {
    return this.http.post<{ id: string }>('/api/admin/runs', {});
  }
  status(): Observable<AdminStatus> {
    return this.http.get<AdminStatus>('/api/admin/status');
  }
}

export function toPostInput(p: Post): PostInput {
  return {
    title: p.title,
    slug: p.slug,
    tldr: p.tldr,
    bodyHtml: p.bodyHtml,
    tags: p.tags,
    status: p.status,
    sources: p.sources,
  };
}

/** Pull the server's `{ error }` message out of an HttpErrorResponse. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  const body = (err as { error?: unknown })?.error;
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  return fallback;
}
