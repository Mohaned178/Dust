import { basename, normalize, parse, sep } from 'node:path';

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

function normalizeConfiguredPath(path: string): string {
  const normalized = normalize(path).toLowerCase();
  if (normalized === parse(normalized).root) return normalized;

  let end = normalized.length;
  while (end > 0 && normalized[end - 1] === sep) end -= 1;
  return normalized.slice(0, end);
}

export function createExclusionPredicate(config: ExclusionConfig = {}): (absPath: string) => boolean {
  const names = new Set([...DEFAULT_EXCLUDED_NAMES, ...(config.names ?? []).map((n) => n.toLowerCase())]);
  const paths = (config.paths ?? []).map(normalizeConfiguredPath);

  return (absPath: string): boolean => {
    if (names.has(basename(absPath).toLowerCase())) return true;
    if (paths.length === 0) return false;
    const normalized = normalize(absPath).toLowerCase();
    const childSep = sep.toLowerCase();
    return paths.some((p) => normalized === p || normalized.startsWith(p + childSep));
  };
}
