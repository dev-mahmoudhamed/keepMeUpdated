import { Injectable, inject } from '@angular/core';
import type { ContentState, Post } from '../../../shared/models';
import { type SourceDef, parseSourcesMd, renderSourcesMd } from '../../../shared/sources-md';
import { RepoClient, type WorkflowRun } from '../core/github';
import { parsePosts, serializePosts } from './post-changes';

const POSTS = 'content/posts.json';
const STATE = 'content/state.json';
const SOURCES = 'sources.md';

/** The admin panel's data: the repository's content files, read and committed through GitHub. */
@Injectable({ providedIn: 'root' })
export class ContentRepo {
  private readonly repo = inject(RepoClient);

  async loadPosts(): Promise<Post[]> {
    return parsePosts((await this.repo.readText(POSTS)).text);
  }

  /** `change` may run more than once (it's re-applied if a gather committed meanwhile), so keep it pure. */
  savePosts(change: (posts: Post[]) => Post[], message: string): Promise<void> {
    return this.repo.commitFile(POSTS, (text) => serializePosts(change(parsePosts(text))), message);
  }

  async loadSources(): Promise<SourceDef[]> {
    return parseSourcesMd((await this.repo.readText(SOURCES)).text).sources;
  }

  saveSources(change: (defs: SourceDef[]) => SourceDef[], message: string): Promise<void> {
    return this.repo.commitFile(SOURCES, (text) => renderSourcesMd(change(parseSourcesMd(text).sources)), message);
  }

  async loadState(): Promise<ContentState | null> {
    const { text } = await this.repo.readText(STATE);
    return text.trim() ? (JSON.parse(text) as ContentState) : null;
  }

  dispatchGather(inputs: { mode: string; post_id?: string }): Promise<void> {
    return this.repo.dispatchGather(inputs);
  }

  listGatherRuns(): Promise<WorkflowRun[]> {
    return this.repo.listGatherRuns();
  }
}
