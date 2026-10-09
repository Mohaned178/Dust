import type { CategoryId } from '@dust/core';
import { CacheIcon, CodeIcon, DeleteIcon, DocumentIcon, PackageIcon } from '../ui/icons';
import type { IconComponent } from '../ui/icons';

/** Plain-language names and one-line explanations for the cleanup categories. */
export const CATEGORY_COPY: Record<CategoryId, { name: string; description: string }> = {
  temp: { name: 'Temporary files', description: 'Files Windows and apps leave behind while working.' },
  'recycle-bin': { name: 'Recycle Bin', description: 'Deleted files that still take up space.' },
  'npm-cache': { name: 'Package cache', description: 'Downloaded packages that are fetched again when needed.' },
  'app-caches': { name: 'App caches', description: 'Data apps rebuild the next time they start.' },
  'npm-projects': {
    name: 'Project dependencies',
    description: 'node_modules folders in projects you have not used for a while.',
  },
};

export function categoryName(id: CategoryId): string {
  return CATEGORY_COPY[id].name;
}

/** The 20px glyph for each category's row. */
export const CATEGORY_ICONS: Record<CategoryId, IconComponent> = {
  temp: DocumentIcon,
  'recycle-bin': DeleteIcon,
  'npm-cache': PackageIcon,
  'app-caches': CacheIcon,
  'npm-projects': CodeIcon,
};

/** What Quick clean covers, in plain words. It never includes developer dependencies. */
export const QUICK_CLEAN_NOTE =
  'Quick clean covers temporary files, the Recycle Bin, package caches and app caches. It never touches project dependencies.';
