import { UNINSTALL_VERIFY_GRACE_MS, UNINSTALL_VERIFY_POLL_MS } from './types';

export interface VerifyOptions {
  check: () => Promise<boolean> | boolean;
  pollMs?: number;
  graceMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  shouldStop?: () => boolean;
  onAttempt?: (attempt: number) => void;
}

export interface VerifyResult {
  gone: boolean;
  attempts: number;
  skipped: boolean;
  elapsedMs: number;
}

export async function waitForRemoval(options: VerifyOptions): Promise<VerifyResult> {
  const pollMs = options.pollMs ?? UNINSTALL_VERIFY_POLL_MS;
  const graceMs = options.graceMs ?? UNINSTALL_VERIFY_GRACE_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  let attempts = 0;
  let skipped = false;

  for (;;) {
    attempts += 1;
    const stillPresent = await options.check();
    const elapsedMs = now() - startedAt;
    if (!stillPresent) return { gone: true, attempts, skipped, elapsedMs };
    options.onAttempt?.(attempts);
    if (options.shouldStop?.() === true) {
      skipped = true;
      return { gone: false, attempts, skipped, elapsedMs };
    }
    if (elapsedMs >= graceMs) return { gone: false, attempts, skipped, elapsedMs };
    await sleep(pollMs);
  }
}
