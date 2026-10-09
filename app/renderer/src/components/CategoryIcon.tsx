import type { CategoryId } from '@dust/core';
import { AppWindowIcon, ClockIcon, CodeIcon, PackageIcon, TrashIcon } from './icons';

const ICONS: Record<CategoryId, typeof ClockIcon> = {
  temp: ClockIcon,
  'recycle-bin': TrashIcon,
  'npm-cache': PackageIcon,
  'app-caches': AppWindowIcon,
  'npm-projects': CodeIcon,
};

export function CategoryIcon({ category, className }: { category: CategoryId; className?: string }) {
  const Icon = ICONS[category];
  return <Icon className={className} />;
}
