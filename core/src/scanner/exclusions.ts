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

export interface ExclusionMatcher {
  /** True when an entry with this name is excluded wherever it appears. */
  name: (name: string) => boolean;
  /** Absolute-path exclusions, or null when none are configured. */
  path: ((absPath: string) => boolean) | null;
}

export function createExclusionMatcher(config: ExclusionConfig = {}): ExclusionMatcher {
  const names = new Set([...DEFAULT_EXCLUDED_NAMES, ...(config.names ?? []).map((n) => n.toLowerCase())]);
  const paths = (config.paths ?? []).map(normalizeConfiguredPath);
  const childSep = sep.toLowerCase();
  return {
    name: (name) => names.has(name.toLowerCase()),
    path:
      paths.length === 0
        ? null
        : (absPath) => {
            const normalized = normalize(absPath).toLowerCase();
            return paths.some((p) => normalized === p || normalized.startsWith(p + childSep));
          },
  };
}

export function createExclusionPredicate(config: ExclusionConfig = {}): (absPath: string) => boolean {
  const matcher = createExclusionMatcher(config);
  return (absPath: string): boolean => matcher.name(basename(absPath)) || (matcher.path?.(absPath) ?? false);
}
