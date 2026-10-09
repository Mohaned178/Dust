/**
 * node_modules folders that ship inside installed apps (Electron apps, editor extensions, global tools) look like
 * projects to discovery, but deleting them breaks the app and "npm ci" cannot bring them back. These paths are never
 * offered, whatever the scan or a saved snapshot says.
 */
export const INSTALLED_SOFTWARE_REASON = 'part of an installed app — not offered';

/** Folders directly under a drive root that hold installed software. */
const INSTALL_ROOTS = new Set(['program files', 'program files (x86)', 'programdata', 'windows']);

export function isInstalledSoftwarePath(path: string): boolean {
  const segments = path
    .toLowerCase()
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);
  if (segments.length > 1 && INSTALL_ROOTS.has(segments[1]!)) return true;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const next = segments[index + 1];
    // %APPDATA% and %LOCALAPPDATA% hold per-user installs (AppData\Local\Programs, Discord, global npm, nvm, Volta).
    // AppData\Local\Temp is scratch space, not an install.
    if (segment === 'appdata' && !(next === 'local' && segments[index + 2] === 'temp')) return true;
    // Editor extensions: .vscode\extensions, .cursor\extensions, .windsurf\extensions and the like.
    if (segment.startsWith('.') && next === 'extensions') return true;
    // A packaged Electron app's own sources.
    if (segment === 'resources' && (next === 'app' || next === 'app.asar.unpacked')) return true;
    // Scoop installs.
    if (segment === 'scoop' && next === 'apps') return true;
  }
  return false;
}
