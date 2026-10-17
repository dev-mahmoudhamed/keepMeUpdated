import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, resource, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucidePencil, LucidePlus, LucideX } from '@lucide/angular';
import type { SourceStatus } from '../../../../shared/models';
import type { SourceDef } from '../../../../shared/sources-md';
import { normalizeUrl } from '../../../../shared/url';
import { SAVED_MESSAGE, githubErrorText } from '../../core/github';
import { ToastService } from '../../core/toast';
import { ContentRepo } from '../content-repo';

const URL_PATTERN = /^https?:\/\/\S+$/i;

/** A sources.md row plus its last fetch result from content/state.json. */
export type SourceRow = SourceDef & SourceStatus & { key: string };

class DuplicateFeedError extends Error {
  constructor() {
    super('That feed is already in the list.');
  }
}

@Component({
  selector: 'app-sources',
  imports: [ReactiveFormsModule, LucidePlus, LucidePencil, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sources.html',
  styleUrl: './sources.css',
})
export class Sources {
  private readonly content = inject(ContentRepo);
  private readonly toast = inject(ToastService);
  private readonly firstField = viewChild<ElementRef<HTMLInputElement>>('firstField');

  protected readonly sources = resource({
    loader: async () => {
      const [defs, state] = await Promise.all([this.content.loadSources(), this.content.loadState()]);
      return defs.map((d): SourceRow => {
        const key = normalizeUrl(d.feedUrl);
        return { ...d, ...(state?.sourceStatus[key] ?? {}), key };
      });
    },
  });
  protected readonly rows = computed(() => (this.sources.hasValue() ? this.sources.value() : []));
  /** Sources grouped by their sources.md section, in file order. */
  protected readonly groups = computed(() => {
    const map = new Map<string, SourceRow[]>();
    for (const s of this.rows()) {
      const name = s.group?.trim() || 'Other';
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(s);
    }
    return [...map].map(([name, sources]) => ({ name, sources }));
  });

  /** null = drawer closed, 'new' = adding, otherwise the source being edited. */
  protected readonly editing = signal<SourceRow | 'new' | null>(null);
  protected readonly saving = signal(false);
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
    if (!iso) return 'Not fetched yet';
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (mins < 1) return 'Fetched just now';
    if (mins < 60) return `Fetched ${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `Fetched ${hours} h ago`;
    return `Fetched ${Math.round(hours / 24)} days ago`;
  }

  protected open(source: SourceRow | 'new'): void {
    this.editing.set(source);
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

  private toDef(): SourceDef {
    const v = this.form.getRawValue();
    const sel = v.selectors;
    return {
      name: v.name.trim(),
      siteUrl: v.siteUrl.trim(),
      type: v.type,
      feedUrl: v.feedUrl.trim(),
      defaultTags: [
        ...new Set(
          v.tags
            .split(',')
            .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
            .filter(Boolean),
        ),
      ],
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

  private async commit(change: (defs: SourceDef[]) => SourceDef[], message: string): Promise<boolean> {
    this.saving.set(true);
    this.formError.set('');
    try {
      await this.content.saveSources(change, message);
      this.toast.show(SAVED_MESSAGE);
      this.sources.reload();
      return true;
    } catch (err) {
      const text = err instanceof DuplicateFeedError ? err.message : githubErrorText(err);
      if (this.editing()) this.formError.set(text);
      else this.toast.show(text, 'error');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    const sel = this.form.controls.selectors.getRawValue();
    if (this.type() === 'html' && (!sel.item.trim() || !sel.title.trim() || !sel.link.trim())) {
      this.formError.set('Web page sources need item, title and link selectors.');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const editing = this.editing();
    const def = this.toDef();
    const key = normalizeUrl(def.feedUrl);
    const oldKey = editing && editing !== 'new' ? editing.key : null;
    const change = (defs: SourceDef[]) => {
      if (defs.some((d) => normalizeUrl(d.feedUrl) === key && normalizeUrl(d.feedUrl) !== oldKey)) throw new DuplicateFeedError();
      return oldKey ? defs.map((d) => (normalizeUrl(d.feedUrl) === oldKey ? def : d)) : [...defs, def];
    };
    if (await this.commit(change, `admin: ${oldKey ? 'update' : 'add'} source "${def.name}"`)) this.close();
  }

  protected async remove(): Promise<void> {
    const editing = this.editing();
    if (!editing || editing === 'new') return;
    if (await this.commit((defs) => defs.filter((d) => normalizeUrl(d.feedUrl) !== editing.key), `admin: delete source "${editing.name}"`)) {
      this.close();
    }
  }

  protected toggle(source: SourceRow): void {
    const enabled = !source.enabled;
    void this.commit(
      (defs) => defs.map((d) => (normalizeUrl(d.feedUrl) === source.key ? { ...d, enabled } : d)),
      `admin: turn ${enabled ? 'on' : 'off'} source "${source.name}"`,
    );
  }
}
