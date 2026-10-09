export interface AppIconShell {
  exists: (path: string) => boolean;
  /** Shell-associated icon (works for .exe/.dll; returns a blank image for .ico). */
  fileIcon: (path: string) => Promise<{ isEmpty(): boolean; toDataURL(): string }>;
  /** Decodes an image file (used for .ico, which fileIcon cannot read). */
  imageFromPath: (path: string) => {
    isEmpty(): boolean;
    resize(options: { width: number; height: number }): { toDataURL(): string };
  };
}

const ICON_SIZE_PX = 32;

/**
 * Reads an app icon file as a PNG data URL, or null when it cannot be shown.
 * `.ico` files are decoded directly: `app.getFileIcon` only returns the generic
 * blank document image for them, so those rows would look icon-less.
 */
export async function readAppIconDataUrl(iconPath: string, shell: AppIconShell): Promise<string | null> {
  if (!shell.exists(iconPath)) return null;
  try {
    if (/\.ico$/i.test(iconPath)) {
      const image = shell.imageFromPath(iconPath);
      if (image.isEmpty()) return null;
      return image.resize({ width: ICON_SIZE_PX, height: ICON_SIZE_PX }).toDataURL();
    }
    const icon = await shell.fileIcon(iconPath);
    return icon.isEmpty() ? null : icon.toDataURL();
  } catch {
    return null;
  }
}
