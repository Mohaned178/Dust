export function renderIcon(size: number): Buffer;
export function encodeIco(entries: Array<{ size: number; pixels: Buffer }>): Buffer;
export function buildIcon(): Buffer;
export function encodePng(size: number, pixels: Buffer): Buffer;
export function buildIconPng(): Buffer;
