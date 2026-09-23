export interface ThrottlerOptions {
  intervalMs?: number;
  now?: () => number;
}

export class ThrottledEmitter<T> {
  private readonly intervalMs: number;
  private readonly now: () => number;
  private latest: T | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEmit = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly emit: (value: T) => void,
    options: ThrottlerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 100;
    this.now = options.now ?? Date.now;
  }

  push(value: T): void {
    this.latest = value;
    if (this.timer !== null) return;
    const elapsed = this.now() - this.lastEmit;
    if (elapsed >= this.intervalMs) {
      this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.intervalMs - elapsed);
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.latest === null) return;
    const value = this.latest;
    this.latest = null;
    this.lastEmit = this.now();
    this.emit(value);
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.latest = null;
  }
}
