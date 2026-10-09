/** The 40 px strip at the top. It is the window's drag region; the native window buttons overlay its right edge. */
export function TitleBar() {
  return (
    <header className="flex h-[env(titlebar-area-height,var(--titlebar-height))] shrink-0 items-center gap-2 pl-4 select-none [-webkit-app-region:drag]">
      <svg viewBox="0 0 20 20" className="size-5 text-accent" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="16" height="16" rx="4" fill="currentColor" />
        <path
          d="M6 10.5 9 13.5 14.5 7"
          stroke="var(--on-accent)"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-body font-semibold">Dust</span>
    </header>
  );
}
