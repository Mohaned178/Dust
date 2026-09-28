import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildIcon, buildIconPng, encodeIco, encodePng, renderIcon } from '../scripts/make-icon.mjs';

describe('renderIcon', () => {
  it('returns bottom-up BGRA pixels with alpha', () => {
    const pixels = renderIcon(16);
    expect(pixels).toHaveLength(16 * 16 * 4);
    const cornerAlpha = pixels[3];
    expect(cornerAlpha).toBe(0);
    const center = (8 * 16 + 8) * 4;
    expect(pixels[center + 3]).toBe(255);
  });
});

describe('buildIcon', () => {
  it('writes a valid multi-size ICO', () => {
    const icon = buildIcon();
    expect(icon.readUInt16LE(0)).toBe(0);
    expect(icon.readUInt16LE(2)).toBe(1);
    const count = icon.readUInt16LE(4);
    expect(count).toBe(7);

    const sizes = [16, 24, 32, 48, 64, 128, 256];
    for (let index = 0; index < count; index += 1) {
      const entry = 6 + index * 16;
      const size = sizes[index];
      const expectedByte = size >= 256 ? 0 : size;
      expect(icon.readUInt8(entry)).toBe(expectedByte);
      expect(icon.readUInt8(entry + 1)).toBe(expectedByte);
      expect(icon.readUInt16LE(entry + 6)).toBe(32);
      const length = icon.readUInt32LE(entry + 8);
      const offset = icon.readUInt32LE(entry + 12);
      const maskRowBytes = Math.ceil(Math.ceil(size / 8) / 4) * 4;
      expect(length).toBe(40 + size * size * 4 + maskRowBytes * size);
      expect(icon.readUInt32LE(offset)).toBe(40);
      expect(icon.readInt32LE(offset + 4)).toBe(size);
      expect(icon.readInt32LE(offset + 8)).toBe(size * 2);
      expect(offset + length).toBeLessThanOrEqual(icon.length);
    }
  });

  it('encodes arbitrary entries', () => {
    const icon = encodeIco([{ size: 16, pixels: renderIcon(16) }]);
    expect(icon.readUInt16LE(4)).toBe(1);
    expect(icon.readUInt32LE(6 + 8)).toBe(40 + 16 * 16 * 4 + 4 * 16);
  });
});

describe('encodePng', () => {
  it('writes a top-down RGBA PNG', () => {
    const png = encodePng(16, renderIcon(16));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(8)).toBe(13);
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(16);
    expect(png.readUInt32BE(20)).toBe(16);
    expect(png.readUInt8(24)).toBe(8);
    expect(png.readUInt8(25)).toBe(6);
    expect(png.toString('ascii', png.length - 8, png.length - 4)).toBe('IEND');

    const idatLength = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect(raw).toHaveLength(16 * (1 + 16 * 4));
    expect(raw.readUInt8(0)).toBe(0);
    expect(raw.readUInt8(1 + 3)).toBe(0);
    const center = 8 * (1 + 16 * 4) + 1 + 8 * 4;
    expect(raw.readUInt8(center + 3)).toBe(255);
  });

  it('builds a non-empty icon PNG', () => {
    const png = buildIconPng();
    expect(png.length).toBeGreaterThan(100);
  });
});
