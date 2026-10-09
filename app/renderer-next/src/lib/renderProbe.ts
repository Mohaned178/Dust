/**
 * A hook for tests: it is told each time a list row's own body renders, so a test can prove that background data
 * (sizes and icons arriving) does not re-render rows that did not change. It does nothing in the app.
 */
let probe: ((id: string) => void) | null = null;

export function setRowRenderProbe(next: ((id: string) => void) | null): void {
  probe = next;
}

export function probeRowRender(id: string): void {
  probe?.(id);
}
