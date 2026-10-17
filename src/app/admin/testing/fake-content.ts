import type { ContentState, Post } from '../../../../shared/models';
import type { SourceDef } from '../../../../shared/sources-md';
import type { WorkflowRun } from '../../core/github';
import { ContentRepo } from '../content-repo';

/** In-memory stand-in for the repository, for admin page tests. */
export class FakeContent implements Pick<ContentRepo, keyof ContentRepo> {
  commits: string[] = [];
  dispatched: { mode: string; post_id?: string }[] = [];
  constructor(
    public posts: Post[] = [],
    public sources: SourceDef[] = [],
    public state: ContentState | null = null,
    public runs: WorkflowRun[] = [],
  ) {}

  async loadPosts(): Promise<Post[]> {
    return structuredClone(this.posts);
  }
  async savePosts(change: (posts: Post[]) => Post[], message: string): Promise<void> {
    this.posts = change(structuredClone(this.posts));
    this.commits.push(message);
  }
  async loadSources(): Promise<SourceDef[]> {
    return structuredClone(this.sources);
  }
  async saveSources(change: (defs: SourceDef[]) => SourceDef[], message: string): Promise<void> {
    this.sources = change(structuredClone(this.sources));
    this.commits.push(message);
  }
  async loadState(): Promise<ContentState | null> {
    return structuredClone(this.state);
  }
  async dispatchGather(inputs: { mode: string; post_id?: string }): Promise<void> {
    this.dispatched.push(inputs);
  }
  async listGatherRuns(): Promise<WorkflowRun[]> {
    return structuredClone(this.runs);
  }
}

export const provideFakeContent = (fake: FakeContent) => ({ provide: ContentRepo, useValue: fake });

/** Let promise-based loaders settle, then render. */
export async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }
}
