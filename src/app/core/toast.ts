import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error';
}

/** Short confirmations ("Saved", "Deleted") announced through a live region in the admin shell. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private next = 1;
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  show(text: string, tone: Toast['tone'] = 'ok'): void {
    const id = this.next++;
    this._toasts.update((t) => [...t, { id, text, tone }]);
    setTimeout(() => this.dismiss(id), tone === 'error' ? 6000 : 3000);
  }

  dismiss(id: number): void {
    this._toasts.update((t) => t.filter((x) => x.id !== id));
  }
}
