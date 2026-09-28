import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SUPERSAMPLE = 4;
const TEAL = [0x0f, 0x6e, 0x6e];
const WHITE = [0xff, 0xff, 0xff];

function insideRoundedRect(x, y, left, top, width, height, radius) {
  const clampedX = Math.min(Math.max(x, left + radius), left + width - radius);
  const clampedY = Math.min(Math.max(y, top + radius), top + height - radius);
  const dx = x - clampedX;
  const dy = y - clampedY;
  return dx * dx + dy * dy <= radius * radius;
}

function colorAt(x, y, size) {
  const tileRadius = size * 0.22;
  if (!insideRoundedRect(x, y, 0, 0, size, size, tileRadius)) return null;
  const barHeight = size * 0.11;
  const barRadius = barHeight / 2;
  const bars = [
    { width: size * 0.58, top: size * 0.26 },
    { width: size * 0.42, top: size * 0.445 },
    { width: size * 0.26, top: size * 0.63 },
  ];
  for (const bar of bars) {
    const left = (size - bar.width) / 2;
    if (insideRoundedRect(x, y, left, bar.top, bar.width, barHeight, barRadius)) return WHITE;
  }
  return TEAL;
}

export function renderIcon(size) {
  const step = 1 / SUPERSAMPLE;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const color = colorAt(px + (sx + 0.5) * step, py + (sy + 0.5) * step, size);
          if (color === null) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          covered += 1;
        }
      }
      const offset = (py * size + px) * 4;
      if (covered === 0) continue;
      pixels[offset] = Math.round(b / covered);
      pixels[offset + 1] = Math.round(g / covered);
      pixels[offset + 2] = Math.round(r / covered);
      pixels[offset + 3] = Math.round((covered / samples) * 255);
    }
  }
  return pixels;
}

export function encodeIco(entries) {
  const count = entries.length;
  const headerSize = 6 + count * 16;
  const images = entries.map((entry) => {
    const size = entry.size;
    const maskRowBytes = Math.ceil(Math.ceil(size / 8) / 4) * 4;
    const xor = Buffer.alloc(size * size * 4);
    for (let row = 0; row < size; row += 1) {
      const sourceRow = size - 1 - row;
      entry.pixels.copy(xor, row * size * 4, sourceRow * size * 4, (sourceRow + 1) * size * 4);
    }
    const mask = Buffer.alloc(maskRowBytes * size);
    const info = Buffer.alloc(40);
    info.writeUInt32LE(40, 0);
    info.writeInt32LE(size, 4);
    info.writeInt32LE(size * 2, 8);
    info.writeUInt16LE(1, 12);
    info.writeUInt16LE(32, 14);
    info.writeUInt32LE(0, 16);
    info.writeUInt32LE(xor.length, 20);
    return { size, data: Buffer.concat([info, xor, mask]) };
  });

  const total = headerSize + images.reduce((sum, image) => sum + image.data.length, 0);
  const out = Buffer.alloc(total);
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(count, 4);
  let offset = headerSize;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    out.writeUInt8(image.size >= 256 ? 0 : image.size, entry);
    out.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1);
    out.writeUInt8(0, entry + 2);
    out.writeUInt8(0, entry + 3);
    out.writeUInt16LE(1, entry + 4);
    out.writeUInt16LE(32, entry + 6);
    out.writeUInt32LE(image.data.length, entry + 8);
    out.writeUInt32LE(offset, entry + 12);
    image.data.copy(out, offset);
    offset += image.data.length;
  });
  return out;
}

export function buildIcon() {
  return encodeIco(SIZES.map((size) => ({ size, pixels: renderIcon(size) })));
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const target = join(appRoot, 'resources', 'icon.ico');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buildIcon());
  console.log(`wrote ${target}`);
}
