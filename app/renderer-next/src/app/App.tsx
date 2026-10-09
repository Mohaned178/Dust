/** Blank shell. The title bar, sidebar and pages arrive in phase 2. */
export function App() {
  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <header className="flex h-[env(titlebar-area-height,var(--titlebar-height))] shrink-0 items-center pl-4 text-body font-semibold [-webkit-app-region:drag]">
        Dust
      </header>
      <main className="flex-1 px-8 py-6">
        <h1 className="text-title">Dust</h1>
      </main>
    </div>
  );
}
