import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideExternalLink, LucidePlus, LucideSparkles, LucideTrash2, LucideX } from '@lucide/angular';
import type { Post, PostSource, PostStatus } from '../../../../shared/models';
import { slugify } from '../../../../shared/slug';
import { SAVED_MESSAGE, githubErrorText } from '../../core/github';
import { ToastService } from '../../core/toast';
import { ContentRepo } from '../content-repo';
import { type PostInput, SlugTakenError, upsertPost } from '../post-changes';
import { RichEditor } from '../rich-editor/rich-editor';

type SourceForm = FormGroup<{
  siteName: FormControl<string>;
  url: FormControl<string>;
  title: FormControl<string>;
  /** Not shown in the form, but kept so saving doesn't drop them. */
  sourceId: FormControl<string | undefined>;
  publishedAt: FormControl<string | undefined>;
}>;

const URL_PATTERN = /^https?:\/\/\S+$/i;

const sourceForm = (s: Partial<PostSource> = {}): SourceForm =>
  new FormGroup({
    siteName: new FormControl(s.siteName ?? '', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    url: new FormControl(s.url ?? '', { nonNullable: true, validators: [Validators.required, Validators.pattern(URL_PATTERN)] }),
    title: new FormControl(s.title ?? '', { nonNullable: true, validators: [Validators.maxLength(300)] }),
    sourceId: new FormControl<string | undefined>(s.sourceId, { nonNullable: true }),
    publishedAt: new FormControl<string | undefined>(s.publishedAt, { nonNullable: true }),
  });

@Component({
  selector: 'app-post-editor',
  imports: [ReactiveFormsModule, RouterLink, RichEditor, LucideArrowLeft, LucidePlus, LucideTrash2, LucideSparkles, LucideExternalLink, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './post-editor.html',
  styleUrl: './post-editor.css',
})
export class PostEditor {
  /** Route param; undefined on /admin/posts/new. */
  readonly id = input<string>();

  private readonly content = inject(ContentRepo);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(300)] }),
    slug: new FormControl('', { nonNullable: true, validators: [Validators.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), Validators.maxLength(100)] }),
    tldr: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(400)] }),
    status: new FormControl<PostStatus>('draft', { nonNullable: true }),
    tags: new FormControl<string[]>([], { nonNullable: true }),
    bodyHtml: new FormControl('', { nonNullable: true }),
    sources: new FormArray<SourceForm>([]),
  });

  protected readonly loaded = signal<Post | null>(null);
  protected readonly loadError = signal('');
  protected readonly saving = signal(false);
  protected readonly resummarizing = signal(false);
  protected readonly formError = signal('');
  protected readonly submitted = signal(false);
  protected readonly slugEdited = signal(false);
  protected readonly tagDraft = signal('');
  protected readonly isNew = computed(() => !this.id());
  private readonly tldrLength = signal(0);
  protected readonly tldrLeft = computed(() => 400 - this.tldrLength());

  constructor() {
    this.form.controls.title.valueChanges.pipe(takeUntilDestroyed()).subscribe((title) => {
      if (this.isNew() && !this.slugEdited()) this.form.controls.slug.setValue(slugify(title));
    });
    this.form.controls.tldr.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => this.tldrLength.set(v.length));

    effect(() => {
      const id = this.id();
      if (id) untracked(() => void this.load(id));
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  protected warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.form.dirty) event.preventDefault();
  }

  /** Route guard: confirm before leaving with unsaved edits. */
  canLeave(): boolean {
    return !this.form.dirty || window.confirm('Leave without saving? Your changes will be lost.');
  }

  protected get sources(): FormArray<SourceForm> {
    return this.form.controls.sources;
  }

  protected showError(control: 'title' | 'slug' | 'tldr'): boolean {
    const c = this.form.controls[control];
    return c.invalid && (c.touched || this.submitted());
  }

  protected sourceInvalid(group: SourceForm, field: 'siteName' | 'url'): boolean {
    const c = group.controls[field];
    return c.invalid && (c.touched || this.submitted());
  }

  protected addTagsFrom(text: string): void {
    const incoming = text
      .split(',')
      .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
      .filter(Boolean);
    if (!incoming.length) return;
    const tags = [...new Set([...this.form.controls.tags.value, ...incoming])].slice(0, 10);
    this.form.controls.tags.setValue(tags);
    this.form.controls.tags.markAsDirty();
    this.tagDraft.set('');
  }

  protected onTagKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.addTagsFrom(this.tagDraft());
    } else if (event.key === 'Backspace' && !this.tagDraft() && this.form.controls.tags.value.length) {
      this.removeTag(this.form.controls.tags.value.at(-1)!);
    }
  }

  protected removeTag(tag: string): void {
    this.form.controls.tags.setValue(this.form.controls.tags.value.filter((t) => t !== tag));
    this.form.controls.tags.markAsDirty();
  }

  protected addSource(): void {
    this.sources.push(sourceForm());
    this.form.markAsDirty();
  }

  protected removeSource(index: number): void {
    this.sources.removeAt(index);
    this.form.markAsDirty();
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    this.formError.set('');
    this.addTagsFrom(this.tagDraft());
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.saving()) return;
    const v = this.form.getRawValue();
    const body: PostInput = {
      title: v.title.trim(),
      slug: v.slug || undefined,
      tldr: v.tldr.trim(),
      bodyHtml: v.bodyHtml,
      tags: v.tags,
      status: v.status,
      sources: v.sources.map((s) => ({
        siteName: s.siteName.trim(),
        url: s.url.trim(),
        title: s.title.trim(),
        ...(s.sourceId ? { sourceId: s.sourceId } : {}),
        ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
      })),
    };
    const isNew = this.isNew();
    const id = this.id() ?? globalThis.crypto.randomUUID();
    const now = new Date().toISOString();
    let saved: Post | undefined;
    this.saving.set(true);
    try {
      await this.content.savePosts((posts) => {
        const result = upsertPost(posts, id, body, now);
        saved = result.post;
        return result.posts;
      }, `admin: ${isNew ? 'add' : 'update'} post "${body.title}"`);
      this.form.markAsPristine();
      this.toast.show(SAVED_MESSAGE);
      if (isNew) await this.router.navigate(['/admin/posts', id], { replaceUrl: true });
      else if (saved) this.apply(saved);
    } catch (err) {
      if (err instanceof SlugTakenError) {
        this.form.controls.slug.setErrors({ server: err.message });
        this.form.controls.slug.markAsTouched();
      } else {
        this.formError.set(githubErrorText(err));
      }
    } finally {
      this.saving.set(false);
    }
  }

  protected async resummarize(): Promise<void> {
    const id = this.id();
    if (!id || this.resummarizing()) return;
    if (!window.confirm('Ask Gemini to rewrite the TL;DR and story from the source links? It runs on GitHub and takes a few minutes.')) return;
    this.resummarizing.set(true);
    try {
      await this.content.dispatchGather({ mode: 'resummarize', post_id: id });
      this.toast.show('Re-summarize started. Reload this post in a few minutes to see it.');
    } catch (err) {
      this.toast.show(githubErrorText(err), 'error');
    } finally {
      this.resummarizing.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    this.loadError.set('');
    try {
      const post = (await this.content.loadPosts()).find((p) => p.id === id);
      if (post) this.apply(post);
      else this.loadError.set('This post no longer exists.');
    } catch (err) {
      this.loadError.set(githubErrorText(err));
    }
  }

  private apply(post: Post): void {
    this.loaded.set(post);
    this.slugEdited.set(true);
    this.sources.clear({ emitEvent: false });
    post.sources.forEach((s) => this.sources.push(sourceForm(s), { emitEvent: false }));
    this.form.patchValue(
      { title: post.title, slug: post.slug, tldr: post.tldr, status: post.status, tags: post.tags, bodyHtml: post.bodyHtml },
      { emitEvent: false },
    );
    this.tldrLength.set(post.tldr.length);
    this.form.markAsPristine();
  }
}
