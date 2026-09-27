import { createFsFolderStore } from './folders';
import type { ShortcutResolver } from './folders';
import { createPowerShellRegistryStore } from './registry';
import type { StartupStore } from './startup';

export interface WindowsStartupStoreOptions {
  env?: NodeJS.ProcessEnv;
  resolveShortcut?: ShortcutResolver;
  windowsDir?: string | undefined;
}

export function createWindowsStartupStore(options: WindowsStartupStoreOptions = {}): StartupStore {
  return {
    registry: createPowerShellRegistryStore(),
    folders: createFsFolderStore({
      env: options.env,
      resolveShortcut: options.resolveShortcut,
    }),
    windowsDir: options.windowsDir,
  };
}
