import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { UNINSTALL_JOURNAL_VERSION } from './types';

export type JournalKind =
  | 'started'
  | 'backup'
  | 'uninstaller-spawned'
  | 'uninstaller-exited'
  | 'verify'
  | 'phase'
  | 'files'
  | 'files-started'
  | 'file-item'
  | 'registry'
  | 'startup'
  | 'finished'
  | 'error';

export interface JournalLine {
  v: number;
  ts: number;
  kind: JournalKind;
  planId: string;
  appId: string;
  [key: string]: unknown;
}

export interface JournalOptions {
  path: string;
  planId: string;
  appId: string;
  now?: () => number;
  write?: (text: string) => void;
}

export function journalPathFor(userDataDir: string): string {
  return join(userDataDir, 'uninstall-history.log');
}

export class Journal {
  private readonly path: string;
  private readonly planId: string;
  private readonly appId: string;
  private readonly now: () => number;
  private readonly write: (text: string) => void;
  private failed = false;

  constructor(options: JournalOptions) {
    this.path = options.path;
    this.planId = options.planId;
    this.appId = options.appId;
    this.now = options.now ?? Date.now;
    this.write =
      options.write ??
      ((text: string): void => {
        appendFileSync(this.path, text, 'utf8');
      });
    try {
      mkdirSync(dirname(this.path), { recursive: true });
    } catch {
      /* the first append reports the real failure */
    }
  }

  append(kind: JournalKind, details: Record<string, unknown> = {}): boolean {
    if (this.failed) return false;
    const line = JSON.stringify({
      v: UNINSTALL_JOURNAL_VERSION,
      ts: this.now(),
      kind,
      planId: this.planId,
      appId: this.appId,
      ...details,
    });
    try {
      this.write(`${line}\n`);
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }
}

export function parseJournal(raw: string): JournalLine[] {
  const out: JournalLine[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (
      typeof record.v !== 'number' ||
      typeof record.ts !== 'number' ||
      typeof record.kind !== 'string' ||
      typeof record.planId !== 'string' ||
      typeof record.appId !== 'string'
    ) {
      continue;
    }
    out.push(record as JournalLine);
  }
  return out;
}
