import { describe, expect, it, vi } from 'vitest';
import { readAppIconDataUrl } from '../src/main/app-icon';
import type { AppIconShell } from '../src/main/app-icon';

function makeShell(overrides: Partial<AppIconShell> = {}): AppIconShell {
  return {
    exists: () => true,
    fileIcon: vi.fn(async () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,exe' })),
    imageFromPath: vi.fn(() => ({
      isEmpty: () => false,
      resize: () => ({ toDataURL: () => 'data:image/png;base64,ico' }),
    })),
    ...overrides,
  };
}

describe('readAppIconDataUrl', () => {
  it('returns null without touching the shell when the file is gone', async () => {
    const shell = makeShell({ exists: () => false });
    expect(await readAppIconDataUrl('C:\\App\\app.exe', shell)).toBeNull();
    expect(shell.fileIcon).not.toHaveBeenCalled();
    expect(shell.imageFromPath).not.toHaveBeenCalled();
  });

  it('reads exe icons through the shell file icon', async () => {
    const shell = makeShell();
    expect(await readAppIconDataUrl('C:\\App\\app.exe', shell)).toBe('data:image/png;base64,exe');
    expect(shell.imageFromPath).not.toHaveBeenCalled();
  });

  it('decodes ico files directly instead of the blank shell icon', async () => {
    const shell = makeShell();
    expect(await readAppIconDataUrl('C:\\App\\app.ico', shell)).toBe('data:image/png;base64,ico');
    expect(shell.imageFromPath).toHaveBeenCalledWith('C:\\App\\app.ico');
    expect(shell.fileIcon).not.toHaveBeenCalled();
  });

  it('returns null for empty or unreadable icons', async () => {
    const emptyFileIcon = makeShell({ fileIcon: vi.fn(async () => ({ isEmpty: () => true, toDataURL: () => '' })) });
    expect(await readAppIconDataUrl('C:\\App\\app.exe', emptyFileIcon)).toBeNull();

    const emptyImage = makeShell({
      imageFromPath: vi.fn(() => ({
        isEmpty: () => true,
        resize: () => ({ toDataURL: () => '' }),
      })),
    });
    expect(await readAppIconDataUrl('C:\\App\\app.ICO', emptyImage)).toBeNull();

    const throwing = makeShell({
      fileIcon: vi.fn(async () => {
        throw new Error('nope');
      }),
    });
    expect(await readAppIconDataUrl('C:\\App\\app.exe', throwing)).toBeNull();
  });
});
