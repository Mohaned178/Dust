import { lazy } from 'react';
import type { ComponentType } from 'react';
import {
  AppsNavIcon,
  CleanNavIcon,
  DeveloperNavIcon,
  HealthNavIcon,
  HomeNavIcon,
  SettingsNavIcon,
  StartupNavIcon,
} from '../ui/icons';
import type { IconComponent } from '../ui/icons';
import type { PageId } from './nav';

export interface PageDefinition {
  id: PageId;
  label: string;
  icon: IconComponent;
  Component: ComponentType;
}

// Each page is its own chunk, fetched the first time it is opened.
const HomePage = lazy(() => import('../pages/home/HomePage').then((m) => ({ default: m.HomePage })));
const CleanupPage = lazy(() => import('../pages/cleanup/CleanupPage').then((m) => ({ default: m.CleanupPage })));
const AppsPage = lazy(() => import('../pages/apps/AppsPage').then((m) => ({ default: m.AppsPage })));
const StartupPage = lazy(() => import('../pages/startup/StartupPage').then((m) => ({ default: m.StartupPage })));
const HealthPage = lazy(() => import('../pages/health/HealthPage').then((m) => ({ default: m.HealthPage })));
const DeveloperPage = lazy(() =>
  import('../pages/developer/DeveloperPage').then((m) => ({ default: m.DeveloperPage })),
);
const SettingsPage = lazy(() => import('../pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));

/** In sidebar order. Settings is drawn at the bottom of the sidebar. */
export const PAGES: readonly PageDefinition[] = [
  { id: 'home', label: 'Home', icon: HomeNavIcon, Component: HomePage },
  { id: 'cleanup', label: 'Clean up', icon: CleanNavIcon, Component: CleanupPage },
  { id: 'apps', label: 'Apps', icon: AppsNavIcon, Component: AppsPage },
  { id: 'startup', label: 'Startup', icon: StartupNavIcon, Component: StartupPage },
  { id: 'health', label: 'PC Health', icon: HealthNavIcon, Component: HealthPage },
  { id: 'developer', label: 'Developer', icon: DeveloperNavIcon, Component: DeveloperPage },
  { id: 'settings', label: 'Settings', icon: SettingsNavIcon, Component: SettingsPage },
];
