import type { ScanKind, ScanState } from '../../shared/ipc';

export type AcquireResult = { ok: true; holder: ScanState } | { ok: false; holder: ScanState };

export class ScanLock {
  private holder: ScanState | null = null;

  acquire(kind: ScanKind, root: string, now = Date.now()): AcquireResult {
    if (this.holder) return { ok: false, holder: this.holder };
    this.holder = { kind, root, startedAt: now };
    return { ok: true, holder: this.holder };
  }

  release(): void {
    this.holder = null;
  }

  current(): ScanState | null {
    return this.holder;
  }
}
