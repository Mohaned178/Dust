import type { CategoryId } from '@dust/core';

export const CATEGORY_ORDER: CategoryId[] = ['temp', 'recycle-bin', 'npm-cache', 'app-caches', 'npm-projects'];

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  temp: 'Temp',
  'recycle-bin': 'Recycle Bin',
  'npm-cache': 'npm cache',
  'app-caches': 'App caches',
  'npm-projects': 'npm projects',
};

export function isCategoryId(value: string): value is CategoryId {
  return (CATEGORY_ORDER as string[]).includes(value);
}
