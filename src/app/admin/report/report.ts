import { ChangeDetectionStrategy, Component, computed, inject, input, resource } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideCircleCheck, LucideExternalLink, LucideTriangleAlert } from '@lucide/angular';
import type { Post, ReportLink, Run, SourceReport } from '../../../../shared/models';
import { ContentRepo } from '../content-repo';

const TRIGGER_LABEL: Record<Run['trigger'], string> = { cron: 'Scheduled', manual: 'Manual', 'catch-up': 'Catch-up' };

export interface PostGroup {
  postId?: string;
  post?: Post;
  newPost: boolean;
  links: ReportLink[];
}

export interface Attention {
  kind: 'failed' | 'unposted' | 'unpublished' | 'removed';
  text: string;
  postId?: string;
}

export interface ReportView {
  read: number;
  sourceCount: number;
  onSite: number;
  tooOld: number;
  repeated: number;
  failedSources: number;
  fresh: number;
  newPosts: number;
  newPostLinks: number;
  addedLinks: number;
  addedPosts: number;
  /** New posts by the month they show under on the site, oldest first. */
  months: { label: string; count: number }[];
  /** Sources with errors first, then the most new links. */
  sources: SourceReport[];
  /** New posts (newest first), then the existing posts that got links. */
  groups: PostGroup[];
  attention: Attention[];
}

const monthLabel = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const postDate = (p: Post) => p.publishedAt ?? p.createdAt;

/** Where every link of a run went, checked against the posts as they are now. Null for runs without a report. */
export function buildReport(run: Run, posts: Post[]): ReportView | null {
  const report = run.report;
  if (!report) return null;
  const byId = new Map(posts.map((p) => [p.id, p]));
  const sum = (field: 'read' | 'onSite' | 'tooOld' | 'repeated' | 'fresh') => report.sources.reduce((n, s) => n + s[field], 0);

  const groupsById = new Map<string, PostGroup>();
  const attention: Attention[] = report.sources
    .filter((s) => s.error)
    .map((s) => ({ kind: 'failed' as const, text: `${s.name} couldn’t be read, so its links weren’t checked: ${s.error}` }));
  for (const link of report.links) {
    if (!link.postId) {
      attention.push({ kind: 'unposted', text: `“${link.title}” went into no post.` });
      continue;
    }
    const group = groupsById.get(link.postId) ?? { postId: link.postId, post: byId.get(link.postId), newPost: !!link.newPost, links: [] };
    group.links.push(link);
    groupsById.set(link.postId, group);
  }
  const groups = [...groupsById.values()];
  for (const g of groups) {
    if (!g.post) attention.push({ kind: 'removed', text: `“${g.links[0].title}” was posted, but that post has since been deleted.` });
    else if (g.post.status !== 'published')
      attention.push({ kind: 'unpublished', text: `“${g.post.title}” is ${g.post.status === 'draft' ? 'a draft' : 'hidden'}, so it isn’t on the site.`, postId: g.post.id });
  }

  const created = groups.filter((g) => g.newPost);
  const added = groups.filter((g) => !g.newPost);
  const months = new Map<string, { label: string; count: number }>();
  for (const g of created) {
    if (!g.post) continue;
    const key = postDate(g.post).slice(0, 7);
    const entry = months.get(key) ?? { label: monthLabel(postDate(g.post)), count: 0 };
    entry.count++;
    months.set(key, entry);
  }
  const newestFirst = (a: PostGroup, b: PostGroup) => (b.post ? postDate(b.post) : '').localeCompare(a.post ? postDate(a.post) : '');

  return {
    read: sum('read'),
    sourceCount: report.sources.length,
    onSite: sum('onSite'),
    tooOld: sum('tooOld'),
    repeated: sum('repeated'),
    failedSources: report.sources.filter((s) => s.error).length,
    fresh: sum('fresh'),
    newPosts: created.length,
    newPostLinks: created.reduce((n, g) => n + g.links.length, 0),
    addedLinks: added.reduce((n, g) => n + g.links.length, 0),
    addedPosts: added.length,
    months: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, m]) => m),
    sources: [...report.sources].sort((a, b) => Number(!!b.error) - Number(!!a.error) || b.fresh - a.fresh || a.name.localeCompare(b.name)),
    groups: [...created.sort(newestFirst), ...added.sort(newestFirst)],
    attention,
  };
}

@Component({
  selector: 'app-report',
  imports: [RouterLink, LucideCircleCheck, LucideTriangleAlert, LucideExternalLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './report.html',
  styleUrl: './report.css',
})
export class Report {
  private readonly content = inject(ContentRepo);
  private readonly router = inject(Router);

  /** ?run=<id>; the latest run when missing. */
  readonly run = input<string>();

  protected readonly data = resource({
    loader: async () => {
      const [state, posts] = await Promise.all([this.content.loadState(), this.content.loadPosts()]);
      return { runs: state?.runs ?? [], retentionDays: state?.settings.retentionDays ?? 120, posts };
    },
  });
  protected readonly runs = computed(() => (this.data.hasValue() ? this.data.value().runs : []));
  protected readonly selected = computed(() => this.runs().find((r) => r.id === this.run()) ?? this.runs()[0]);
  protected readonly view = computed(() => {
    const run = this.selected();
    return run && this.data.hasValue() ? buildReport(run, this.data.value().posts) : null;
  });
  protected readonly retentionDays = computed(() => (this.data.hasValue() ? this.data.value().retentionDays : 120));
  protected readonly sourceNames = computed(() => new Map((this.selected()?.report?.sources ?? []).map((s) => [s.sourceId, s.name])));
  protected readonly triggerLabel = TRIGGER_LABEL;

  protected pick(id: string): void {
    void this.router.navigate([], { queryParams: { run: id }, replaceUrl: true });
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  protected day(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  protected count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
  }

  protected postDate(post: Post): string {
    return postDate(post);
  }

  /** Share of all links read, for the funnel bars. */
  protected share(n: number, view: ReportView): number {
    return view.read ? Math.max(n ? 2 : 0, Math.round((n / view.read) * 100)) : 0;
  }
}
