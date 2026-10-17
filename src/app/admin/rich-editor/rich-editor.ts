import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  forwardRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import {
  LucideBold,
  LucideHeading2,
  LucideHeading3,
  LucideImage,
  LucideItalic,
  LucideLink,
  LucideList,
  LucideListOrdered,
  LucideQuote,
  LucideRedo2,
  LucideRemoveFormatting,
  LucideSquareCode,
  LucideUndo2,
} from '@lucide/angular';
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';

/** Tiptap editor bound to a reactive-forms control; the value is HTML ('' when empty). */
@Component({
  selector: 'app-rich-editor',
  imports: [
    LucideBold,
    LucideItalic,
    LucideHeading2,
    LucideHeading3,
    LucideList,
    LucideListOrdered,
    LucideQuote,
    LucideSquareCode,
    LucideLink,
    LucideImage,
    LucideUndo2,
    LucideRedo2,
    LucideRemoveFormatting,
  ],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => RichEditor), multi: true }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rich-editor.html',
  styleUrl: './rich-editor.css',
})
export class RichEditor implements ControlValueAccessor {
  readonly placeholder = input('Write the story…');
  readonly labelledBy = input<string>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private editor?: Editor;
  private pending = '';
  private onChange: (html: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  /** Bumped on every transaction so toolbar pressed-states re-evaluate. */
  protected readonly tick = signal(0);
  protected readonly disabled = signal(false);

  constructor() {
    afterNextRender(() => {
      this.editor = new Editor({
        element: this.host().nativeElement,
        extensions: [
          StarterKit.configure({
            heading: { levels: [2, 3, 4] },
            link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
          }),
          Image,
          Placeholder.configure({ placeholder: this.placeholder() }),
        ],
        content: this.pending,
        editable: !this.disabled(),
        editorProps: {
          attributes: {
            class: 'prose',
            role: 'textbox',
            'aria-multiline': 'true',
            ...(this.labelledBy() ? { 'aria-labelledby': this.labelledBy()! } : {}),
          },
        },
        onUpdate: ({ editor }) => this.onChange(editor.isEmpty ? '' : editor.getHTML()),
        onTransaction: () => this.tick.update((n) => n + 1),
        onBlur: () => this.onTouched(),
      });
    });
    inject(DestroyRef).onDestroy(() => this.editor?.destroy());
  }

  writeValue(value: string | null): void {
    const html = value ?? '';
    if (!this.editor) {
      this.pending = html;
      return;
    }
    if (this.editor.getHTML() !== html) this.editor.commands.setContent(html, { emitUpdate: false });
  }

  registerOnChange(fn: (html: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
    this.editor?.setEditable(!disabled);
  }

  protected active(name: string, attrs?: Record<string, unknown>): boolean {
    this.tick();
    return this.editor?.isActive(name, attrs) ?? false;
  }

  protected can(action: 'undo' | 'redo'): boolean {
    this.tick();
    return this.editor?.can()[action]() ?? false;
  }

  protected run(action: string): void {
    const chain = this.editor?.chain().focus();
    if (!chain) return;
    switch (action) {
      case 'bold':
        chain.toggleBold().run();
        break;
      case 'italic':
        chain.toggleItalic().run();
        break;
      case 'h2':
        chain.toggleHeading({ level: 2 }).run();
        break;
      case 'h3':
        chain.toggleHeading({ level: 3 }).run();
        break;
      case 'bullets':
        chain.toggleBulletList().run();
        break;
      case 'numbers':
        chain.toggleOrderedList().run();
        break;
      case 'quote':
        chain.toggleBlockquote().run();
        break;
      case 'code':
        chain.toggleCodeBlock().run();
        break;
      case 'undo':
        chain.undo().run();
        break;
      case 'redo':
        chain.redo().run();
        break;
      case 'clear':
        chain.unsetAllMarks().clearNodes().run();
        break;
    }
  }

  protected link(): void {
    if (!this.editor) return;
    const current = (this.editor.getAttributes('link')['href'] as string | undefined) ?? '';
    const url = window.prompt('Link address (leave empty to remove the link)', current);
    if (url === null) return;
    const chain = this.editor.chain().focus().extendMarkRange('link');
    if (!url.trim()) chain.unsetLink().run();
    else chain.setLink({ href: url.trim() }).run();
  }

  protected image(): void {
    const url = window.prompt('Image address (https://…)');
    if (!url?.trim() || !this.editor) return;
    const alt = window.prompt('Describe the image for screen readers') ?? '';
    this.editor.chain().focus().setImage({ src: url.trim(), alt }).run();
  }
}
