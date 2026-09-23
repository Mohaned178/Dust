import { join } from 'node:path';
import type { FsProbe } from './types';

export interface RuleEnv {
  temp: string;
  localAppData: string;
  appData: string;
  userProfile: string;
  windowsDir: string;
  programData: string;
}

export function defaultRuleEnv(): RuleEnv {
  return {
    temp: process.env.TEMP ?? process.env.TMP ?? '',
    localAppData: process.env.LOCALAPPDATA ?? '',
    appData: process.env.APPDATA ?? '',
    userProfile: process.env.USERPROFILE ?? '',
    windowsDir: process.env.SystemRoot ?? process.env.windir ?? '',
    programData: process.env.ProgramData ?? '',
  };
}

export function expandProfileWildcard(base: string, pattern: string, probe: FsProbe): string[] {
  const segments = pattern.split(/[\\/]+/).filter((segment) => segment.length > 0);
  let candidates: string[] = [base];

  for (const segment of segments) {
    if (segment === '*') {
      const next: string[] = [];
      for (const candidate of candidates) {
        for (const entry of listDirectories(candidate, probe)) {
          next.push(join(candidate, entry));
        }
      }
      candidates = next;
    } else {
      candidates = candidates.map((candidate) => join(candidate, segment));
    }
  }

  return candidates.filter((candidate) => probe.exists(candidate)).sort();
}

function listDirectories(dir: string, probe: FsProbe): string[] {
  if (!probe.exists(dir)) return [];
  try {
    return probe
      .listDirectory(dir)
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
