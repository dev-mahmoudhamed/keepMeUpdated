const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Caps Gemini usage for one run: a hard call limit, a per-minute throttle, and a
 * kill switch for when the daily free-tier quota is gone.
 */
export class AiBudget {
  private used = 0;
  private quotaGone = false;
  private readonly recent: number[] = [];

  constructor(
    private readonly maxCalls: number,
    private readonly perMinute = 8,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
  ) {}

  get remaining(): number {
    return Math.max(0, this.maxCalls - this.used);
  }

  get exhausted(): boolean {
    return this.quotaGone || this.remaining === 0;
  }

  markQuotaExhausted(): void {
    this.quotaGone = true;
  }

  /** Reserve one call. Waits if the per-minute rate would be exceeded. */
  async take(): Promise<boolean> {
    if (this.exhausted) return false;
    this.used++;
    this.dropExpired();
    if (this.recent.length >= this.perMinute) {
      await this.sleep(this.recent[0] + 60_000 - this.now());
      this.dropExpired();
    }
    this.recent.push(this.now());
    return true;
  }

  private dropExpired(): void {
    const windowStart = this.now() - 60_000;
    while (this.recent.length && this.recent[0] <= windowStart) this.recent.shift();
  }
}
