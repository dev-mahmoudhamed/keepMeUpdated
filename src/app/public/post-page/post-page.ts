import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideExternalLink } from '@lucide/angular';
import type { Post } from '../../../../shared/models';
import { postUrl } from '../../core/api';
import { sourcesLabel, tagTone } from '../feed-utils';
import { NotFound } from '../not-found/not-found';

@Component({
  selector: 'app-post-page',
  imports: [RouterLink, NotFound, LucideArrowLeft, LucideExternalLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './post-page.html',
  styleUrl: './post-page.css',
})
export class PostPage {
  readonly slug = input.required<string>();
  private readonly title = inject(Title);

  protected readonly post = httpResource<Post>(() => postUrl(this.slug()));
  protected readonly notFound = computed(() => (this.post.error() as { status?: number } | undefined)?.status === 404);
  protected readonly published = computed(() => {
    const at = this.post.hasValue() ? this.post.value().publishedAt : undefined;
    return at ? new Date(at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  });
  protected readonly sources = sourcesLabel;
  protected readonly tone = tagTone;

  constructor() {
    effect(() => {
      if (this.post.hasValue()) this.title.setTitle(`${this.post.value().title} · keepMeUpdated`);
      else if (this.notFound()) this.title.setTitle('Not found · keepMeUpdated');
    });
  }

  protected host(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  protected favicon(url: string): string {
    return `https://icons.duckduckgo.com/ip3/${this.host(url)}.ico`;
  }
}
