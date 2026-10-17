import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideFlaskConical, LucidePencil, LucidePlus, LucideX } from '@lucide/angular';
import type { Source } from '../../../../shared/models';
import { AdminApi, type PreviewItem, type SourceInput, errorMessage } from '../../core/api';
import { ToastService } from '../../core/toast';

const URL_PATTERN = /^https?:\/\/\S+$/i;

@Component({
  selector: 'app-sources',
  imports: [ReactiveFormsModule, LucidePlus, LucidePencil, LucideFlaskConical, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sources.html',
  styleUrl: './sources.css',
})
export class Sources {
  private readonly api = inject(AdminApi);
  private readonly toast = inject(ToastService);
  private readonly firstField = viewChild<ElementRef<HTMLInputElement>>('firstField');

  protected readonly sources = httpResource<Source[]>(() => '/api/admin/sources');
  protected readonly rows = computed(() => (this.sources.hasValue() ? this.sources.value() : []));
  /** Sources grouped by their sources.md section, in file order. */
  protected readonly groups = computed(() => {
    const map = new Map<string, Source[]>();
    for (const s of this.rows()) {
      const name = s.group?.trim() || 'Other';
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(s);
    }
    return [...map].map(([name, sources]) => ({ name, sources }));
  });

  /** null = drawer closed, 'new' = adding, otherwise the source being edited. */
  protected readonly editing = signal<Source | 'new' | null>(null);
  protected readonly saving = signal(false);
  protected readonly testing = signal(false);
  protected readonly preview = signal<PreviewItem[] | null>(null);
  protected readonly previewError = signal('');
  protected readonly formError = signal('');
  protected readonly confirmDelete = signal(false);
  protected readonly submitted = signal(false);

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    siteUrl: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(URL_PATTERN)] }),
    type: new FormControl<'rss' | 'html'>('rss', { nonNullable: true }),
    feedUrl: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(URL_PATTERN)] }),
    tags: new FormControl('', { nonNullable: true }),
    group: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
    enabled: new FormControl(true, { nonNullable: true }),
    selectors: new FormGroup({
      item: new FormControl('', { nonNullable: true }),
      title: new FormControl('', { nonNullable: true }),
      link: new FormControl('', { nonNullable: true }),
      date: new FormControl('', { nonNullable: true }),
      summary: new FormControl('', { nonNullable: true }),
    }),
  });
  protected readonly type = toSignal(this.form.controls.type.valueChanges, { initialValue: 'rss' as const });

  protected relative(iso?: string): string {
    if (!iso) return 'Never fetched';
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (mins < 1) return 'Fetched just now';
    if (mins < 60) return `Fetched ${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `Fetched ${hours} h ago`;
    return `Fetched ${Math.round(hours / 24)} days ago`;
  }

  protected open(source: Source | 'new'): void {
    this.editing.set(source);
    this.preview.set(null);
    this.previewError.set('');
    this.formError.set('');
    this.confirmDelete.set(false);
    this.submitted.set(false);
    const s = source === 'new' ? undefined : source;
    this.form.reset({
      name: s?.name ?? '',
      siteUrl: s?.siteUrl ?? '',
      type: s?.type ?? 'rss',
      feedUrl: s?.feedUrl ?? '',
      tags: s?.defaultTags.join(', ') ?? '',
      group: s?.group ?? '',
      enabled: s?.enabled ?? true,
      selectors: {
        item: s?.selectors?.item ?? '',
        title: s?.selectors?.title ?? '',
        link: s?.selectors?.link ?? '',
        date: s?.selectors?.date ?? '',
        summary: s?.selectors?.summary ?? '',
      },
    });
    setTimeout(() => this.firstField()?.nativeElement.focus());
  }

  protected close(): void {
    this.editing.set(null);
  }

  protected invalid(name: 'name' | 'siteUrl' | 'feedUrl'): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitted());
  }

  private toInput(): SourceInput {
    const v = this.form.getRawValue();
    const sel = v.selectors;
    return {
      name: v.name.trim(),
      siteUrl: v.siteUrl.trim(),
      type: v.type,
      feedUrl: v.feedUrl.trim(),
      defaultTags: v.tags
        .split(',')
        .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
        .filter(Boolean),
      enabled: v.enabled,
      ...(v.group.trim() ? { group: v.group.trim() } : {}),
      ...(v.type === 'html'
        ? {
            selectors: {
              item: sel.item.trim(),
              title: sel.title.trim(),
              link: sel.link.trim(),
              ...(sel.date.trim() ? { date: sel.date.trim() } : {}),
              ...(sel.summary.trim() ? { summary: sel.summary.trim() } : {}),
            },
          }
        : {}),
    };
  }

  protected test(): void {
    this.testing.set(true);
    this.preview.set(null);
    this.previewError.set('');
    this.api.testSource(this.toInput()).subscribe({
      next: (res) => {
        this.testing.set(false);
        this.preview.set(res.items);
      },
      error: (err) => {
        this.testing.set(false);
        this.previewError.set(errorMessage(err));
      },
    });
  }

  protected save(): void {
    this.submitted.set(true);
    this.formError.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const editing = this.editing();
    const body = this.toInput();
    this.saving.set(true);
    (editing && editing !== 'new' ? this.api.updateSource(editing.id, body) : this.api.createSource(body)).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.show(editing === 'new' ? 'Source added' : 'Source saved');
        this.close();
        this.sources.reload();
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(errorMessage(err));
      },
    });
  }

  protected remove(): void {
    const editing = this.editing();
    if (!editing || editing === 'new') return;
    this.api.deleteSource(editing.id).subscribe({
      next: () => {
        this.toast.show('Source deleted');
        this.close();
        this.sources.reload();
      },
      error: (err) => this.formError.set(errorMessage(err)),
    });
  }

  protected toggle(source: Source): void {
    const { id, lastFetchedAt, lastError, lastItemCount, ...rest } = source;
    this.api.updateSource(id, { ...rest, enabled: !source.enabled }).subscribe({
      next: () => this.sources.reload(),
      error: (err) => this.toast.show(errorMessage(err), 'error'),
    });
  }
}
