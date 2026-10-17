import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { LucideEye, LucideEyeOff, LucidePencil, LucidePlus, LucideTrash2 } from '@lucide/angular';
import { debounceTime } from 'rxjs';
import type { Post, PostStatus } from '../../../../shared/models';
import { SAVED_MESSAGE, githubErrorText } from '../../core/github';
import { ToastService } from '../../core/toast';
import { ContentRepo } from '../content-repo';
import { deletePost, setStatus } from '../post-changes';

const STATUS_LABEL: Record<PostStatus, string> = { published: 'Published', draft: 'Draft', hidden: 'Hidden' };

@Component({
  selector: 'app-posts-list',
  imports: [RouterLink, LucidePlus, LucidePencil, LucideTrash2, LucideEye, LucideEyeOff],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './posts-list.html',
  styleUrl: './posts-list.css',
})
export class PostsList {
  private readonly content = inject(ContentRepo);
  private readonly toast = inject(ToastService);

  protected readonly q = signal('');
  protected readonly status = signal<'' | PostStatus>('');
  private readonly debouncedQ = toSignal(toObservable(this.q).pipe(debounceTime(250)), { initialValue: '' });

  protected readonly posts = resource({ loader: () => this.content.loadPosts() });
  protected readonly rows = computed(() => {
    const all = this.posts.hasValue() ? this.posts.value() : [];
    const q = this.debouncedQ().trim().toLowerCase();
    return all
      .filter((p) => !this.status() || p.status === this.status())
      .filter((p) => !q || p.title.toLowerCase().includes(q) || p.tags.includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
  protected readonly confirming = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly label = STATUS_LABEL;

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  private async commit(post: Post, change: (posts: Post[]) => Post[], message: string): Promise<boolean> {
    this.busy.set(post.id);
    try {
      await this.content.savePosts(change, message);
      this.toast.show(SAVED_MESSAGE);
      this.posts.reload();
      return true;
    } catch (err) {
      this.toast.show(githubErrorText(err), 'error');
      return false;
    } finally {
      this.busy.set(null);
    }
  }

  protected togglePublish(post: Post): void {
    const status: PostStatus = post.status === 'published' ? 'hidden' : 'published';
    const now = new Date().toISOString();
    void this.commit(post, (posts) => setStatus(posts, post.id, status, now), `admin: ${status === 'published' ? 'publish' : 'unpublish'} "${post.title}"`);
  }

  protected async remove(post: Post): Promise<void> {
    if (await this.commit(post, (posts) => deletePost(posts, post.id), `admin: delete post "${post.title}"`)) this.confirming.set(null);
  }
}
