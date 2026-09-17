import { basename, normalize, sep } from 'node:path';

export interface ExclusionConfig {
  names?: string[];
  paths?: string[];
}

const DEFAULT_EXCLUDED_NAMES = [
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys',
  'system volume information',
  '$recycle.bin',
];

export function createExclusionPredicate(config: ExclusionConfig = {}): (absPath: string) => boolean {
  const names = new Set([...DEFAULT_EXCLUDED_NAMES, ...(config.names ?? []).map((n) => n.toLowerCase())]);
  const paths = (config.paths ?? []).map((p) => normalize(p).toLowerCase());

  return (absPath: string): boolean => {
    if (names.has(basename(absPath).toLowerCase())) return true;
    if (paths.length === 0) return false;
    const normalized = normalize(absPath).toLowerCase();
    const childSep = sep.toLowerCase();
    return paths.some((p) => normalized === p || normalized.startsWith(p + childSep));
  };
}
