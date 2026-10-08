import { basename, dirname } from 'node:path';
import type { InstalledApp } from '../system/installed-apps';
import { vendorKey } from '../system/installed-apps';

// Exact-match identity for an installed app: the folder and registry names a
// leftover could carry. Matching is equality on compact keys (lowercase
// alphanumerics) only. Word overlap was the old approach and matched shared
// words like "microsoft", "server", or "for" across unrelated apps.

export type IdentityMatch = 'product' | 'exe' | 'vendor';

export interface AppIdentity {
  /** Compact product names: display name variants and the install folder name. */
  product: string[];
  /** The main executable's name, a weaker signal (folders like %APPDATA%\Code). */
  exe: string[];
  /** Publisher and install-parent names: folders that may hold product folders. */
  vendor: string[];
}

// Names too generic to identify any one app, whatever the app is called.
const GENERIC_KEYS = new Set([
  'app',
  'apps',
  'application',
  'applications',
  'bin',
  'cache',
  'caches',
  'client',
  'common',
  'commonfiles',
  'components',
  'config',
  'current',
  'data',
  'default',
  'desktop',
  'documents',
  'downloads',
  'driver',
  'drivers',
  'files',
  'helper',
  'install',
  'installer',
  'launcher',
  'lib',
  'local',
  'logs',
  'main',
  'microsoft',
  'packages',
  'plugins',
  'program',
  'programdata',
  'programfiles',
  'programs',
  'runtime',
  'server',
  'service',
  'services',
  'settings',
  'setup',
  'shared',
  'system',
  'temp',
  'tools',
  'uninstall',
  'uninstaller',
  'unins000',
  'update',
  'updater',
  'user',
  'users',
  'windows',
]);

// Tokens that describe a build rather than name a product.
const NOISE_TOKENS = new Set([
  'x64',
  'x86',
  'amd64',
  'arm64',
  'win64',
  'win32',
  'bit',
  '64bit',
  '32bit',
  'version',
  'setup',
  'installer',
  'user',
  'machine',
]);

const PUBLISHER_STOPWORDS = new Set([
  'the',
  'inc',
  'llc',
  'ltd',
  'co',
  'corp',
  'corporation',
  'company',
  'gmbh',
  'ag',
  'sa',
  'srl',
  'bv',
  'pty',
  'limited',
  'technologies',
  'technology',
  'software',
  'foundation',
  'project',
  'team',
  'group',
]);

const GENERIC_INSTALL_LEAVES = new Set(['application', 'app', 'bin', 'current', 'install', 'program', 'x64', 'x86']);

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

function isVersionToken(word: string): boolean {
  return /^v?\d+$/.test(word) || /^\d+(st|nd|rd|th)$/.test(word);
}

/** Strips "(x64)", "[beta]", and a trailing " - 12.0.40664" or " - en-us" from a display name. */
export function cleanDisplayName(displayName: string): string {
  let name = displayName.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  const dash = name.lastIndexOf(' - ');
  if (dash > 0) {
    const tail = name.slice(dash + 3).trim();
    if (/\d/.test(tail) || /^[a-z]{2}(-[a-z]{2,4})?$/i.test(tail)) name = name.slice(0, dash);
  }
  return name.trim();
}

function usable(key: string): boolean {
  return key.length >= 3 && !GENERIC_KEYS.has(key) && !/^\d+$/.test(key);
}

function publisherWords(publisher: string): string[] {
  return words(publisher).filter((word) => !PUBLISHER_STOPWORDS.has(word));
}

function stripIconIndex(value: string): string {
  return value
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/,\s*-?\d+$/, '')
    .replace(/^"|"$/g, '');
}

function installLeaves(installLocation: string): { leaf: string; parent: string } {
  const trimmed = installLocation.trim().replace(/[\\/]+$/, '');
  if (trimmed.length === 0) return { leaf: '', parent: '' };
  let leaf = vendorKey(basename(trimmed));
  let parentPath = dirname(trimmed);
  if (GENERIC_INSTALL_LEAVES.has(leaf)) {
    leaf = vendorKey(basename(parentPath));
    parentPath = dirname(parentPath);
  }
  return { leaf, parent: vendorKey(basename(parentPath)) };
}

export function appIdentity(app: InstalledApp): AppIdentity {
  const product = new Set<string>();
  const exe = new Set<string>();
  const vendor = new Set<string>();

  const nameWords = words(cleanDisplayName(app.displayName)).filter(
    (word) => !NOISE_TOKENS.has(word) && !isVersionToken(word),
  );
  const vendorWords = new Set(publisherWords(app.publisher));
  product.add(nameWords.join(''));
  const withoutVendor = nameWords.filter((word) => !vendorWords.has(word));
  if (withoutVendor.length > 0) product.add(withoutVendor.join(''));

  const { leaf, parent } = installLeaves(app.installLocation);
  if (leaf.length > 0) product.add(leaf);

  // Both "Riot Games" (suffix-free) and "NVIDIA Corporation" (as written)
  // appear as vendor folder and registry key names.
  const publisherKey = [...vendorWords].join('');
  if (publisherKey.length > 0) vendor.add(publisherKey);
  const fullPublisherKey = vendorKey(app.publisher);
  if (fullPublisherKey.length > 0) vendor.add(fullPublisherKey);
  if (parent.length > 0 && !product.has(parent)) vendor.add(parent);

  for (const source of [app.displayIcon]) {
    const path = stripIconIndex(source ?? '');
    if (!/\.exe$/i.test(path)) continue;
    const name = vendorKey(basename(path).replace(/\.exe$/i, ''));
    if (!product.has(name)) exe.add(name);
  }

  const keep = (set: Set<string>) => [...set].filter(usable);
  const productKeys = keep(product);
  return {
    product: productKeys,
    exe: keep(exe).filter((key) => !productKeys.includes(key)),
    // A vendor folder is only ever descended into, never removed while other
    // apps share it, so "microsoft" is allowed here (Microsoft\Teams).
    vendor: [...vendor].filter((key) => (usable(key) || key === 'microsoft') && !productKeys.includes(key)),
  };
}

/**
 * Matches a folder or registry key name against an identity. A trailing
 * version ("Python314", "jdk-23") still counts as the product.
 */
export function matchIdentity(name: string, identity: AppIdentity): IdentityMatch | null {
  const key = vendorKey(name);
  if (key.length < 3) return null;
  if (identity.product.includes(key)) return 'product';
  for (const product of identity.product) {
    if (product.length >= 4 && key.startsWith(product) && /^\d+$/.test(key.slice(product.length))) return 'product';
  }
  if (identity.exe.includes(key)) return 'exe';
  if (identity.vendor.includes(key)) return 'vendor';
  return null;
}
