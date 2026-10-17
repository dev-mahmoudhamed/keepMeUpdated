import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { LucideEye, LucideEyeOff, LucidePencil, LucidePlus, LucideTrash2 } from '@lucide/angular';
import { debounceTime } from 'rxjs';
import type { Post, PostStatus } from '../../../../shared/models';
import { AdminApi, errorMessage, toPostInput } from '../../core/api';
import { ToastService } from '../../core/toast';

const STATUS_LABEL: Record<PostStatus, string> = { published: 'Published', draft: 'Draft', hidden: 'Hidden' };

@Component({
  selector: 'app-posts-list',
  imports: [RouterLink, LucidePlus, LucidePencil, LucideTrash2, LucideEye, LucideEyeOff],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './posts-list.html',
  styleUrl: './posts-list.css',
})
export class PostsList {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);

  protected readonly q = signal('');
  protected readonly status = signal<'' | PostStatus>('');
  private readonly debouncedQ = toSignal(toObservable(this.q).pipe(debounceTime(250)), { initialValue: '' });

  protected readonly posts = httpResource<Post[]>(() => ({
    url: '/api/admin/posts',
    params: { ...(this.status() ? { status: this.status() } : {}), ...(this.debouncedQ() ? { q: this.debouncedQ() } : {}) },
  }));
  protected readonly rows = computed(() => (this.posts.hasValue() ? this.posts.value() : []));
  protected readonly confirming = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly label = STATUS_LABEL;

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  protected togglePublish(post: Post): void {
    const status: PostStatus = post.status === 'published' ? 'hidden' : 'published';
    this.busy.set(post.id);
    this.api.updatePost(post.id, { ...toPostInput(post), status }).subscribe({
      next: () => {
        this.busy.set(null);
        this.toast.show(status === 'published' ? 'Published' : 'Unpublished');
        this.posts.reload();
      },
      error: (err) => {
        this.busy.set(null);
        this.toast.show(errorMessage(err), 'error');
      },
    });
  }

  protected remove(post: Post): void {
    this.busy.set(post.id);
    this.api.deletePost(post.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.confirming.set(null);
        this.toast.show('Post deleted');
        this.posts.reload();
      },
      error: (err) => {
        this.busy.set(null);
        this.toast.show(errorMessage(err), 'error');
      },
    });
  }
}
