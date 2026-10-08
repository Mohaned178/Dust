const TICKS_PER_SECOND = 10_000_000;
const TICKS_PER_MS = 10_000;
const FILETIME_UNIX_EPOCH_DIFF_SECONDS = 11_644_473_600;
// 2^32 ticks = 429 whole seconds + 4_967_296 ticks; splitting the high word
// this way keeps every intermediate below 2^53, so the result matches Node's
// lstat mtimeMs (sec * 1000 + nsec / 1e6) exactly without BigInt.
const HIGH_WORD_SECONDS = 429;
const HIGH_WORD_TICKS = 4_967_296;

export function fileTimePartsToUnixMs(low: number, high: number): number {
  const ticks = high * HIGH_WORD_TICKS + low;
  const remainder = ticks % TICKS_PER_SECOND;
  const seconds = high * HIGH_WORD_SECONDS - FILETIME_UNIX_EPOCH_DIFF_SECONDS + (ticks - remainder) / TICKS_PER_SECOND;
  return seconds * 1000 + remainder / TICKS_PER_MS;
}

// Files small enough to live inside their MFT record report an 8-byte-aligned
// allocation but occupy no clusters; Explorer's "Size on disk" shows 0 for
// them, so anything under one cluster counts as 0.
export function clusterAllocation(allocationSize: number, clusterSize: number): number {
  return allocationSize < clusterSize ? 0 : allocationSize;
}
