import { STARTUP_SOURCES } from './types';
import type { StartupSource } from './types';

export const BACKUP_ENVELOPE_VERSION = 1;

export interface StartupBackupEnvelope {
  v: 1;
  id: string;
  name: string;
  command: string;
  source: StartupSource;
  disabledAt: number;
  fileName?: string;
}

export function encodeBackupEnvelope(envelope: StartupBackupEnvelope): string {
  return JSON.stringify(envelope);
}

export function parseBackupEnvelope(raw: string): StartupBackupEnvelope | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== BACKUP_ENVELOPE_VERSION) return null;
  if (typeof record.id !== 'string' || record.id.length === 0) return null;
  if (typeof record.name !== 'string' || record.name.length === 0) return null;
  if (typeof record.command !== 'string') return null;
  if (typeof record.source !== 'string' || !STARTUP_SOURCES.includes(record.source as StartupSource)) {
    return null;
  }
  if (typeof record.disabledAt !== 'number' || !Number.isFinite(record.disabledAt)) return null;
  if (record.fileName !== undefined && typeof record.fileName !== 'string') return null;
  const envelope: StartupBackupEnvelope = {
    v: 1,
    id: record.id,
    name: record.name,
    command: record.command,
    source: record.source as StartupSource,
    disabledAt: record.disabledAt,
  };
  if (typeof record.fileName === 'string' && record.fileName.length > 0) {
    envelope.fileName = record.fileName;
  }
  return envelope;
}
