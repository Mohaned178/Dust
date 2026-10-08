import { useCallback, useEffect, useRef, useState } from 'react';
import type { CategoryId } from '@dust/core';
import type { DustApi, StartAnalyzeResult, StartupNotice, UninstallLaunchHint } from '../../src/shared/ipc';
import { bumpRendererCount, recordRendererSample } from './instrument';
import { Sidebar } from './components/Sidebar';
import type { NavKey } from './components/Sidebar';
import { SettingsDialog } from './components/SettingsDialog';
import { UpdateBanner } from './components/UpdateBanner';
import { DevCleanupView } from './pages/DevCleanupView';
import { HomeView } from './pages/HomeView';
import type { ToolKey } from './pages/HomeView';
import { QuickCleanView } from './pages/QuickCleanView';
import { ResultsPage } from './pages/ResultsPage';
import { ScanProgress } from './pages/ScanProgress';
import { StartupView } from './pages/StartupView';
import { SystemInfoView } from './pages/SystemInfoView';
import { UninstallView } from './pages/UninstallView';

export interface AppProps {
  api: DustApi;
}

// The main path is three steps: Home (pick a drive) → Scan → Results.
// Tools (uninstall, startup, developer cleanup, system info) sit beside it.
type View =
  | { name: 'home' }
  | { name: 'scan'; root: string; runId: string; usedBytes: number | null }
  | { name: 'results'; root: string; category: CategoryId | null }
  | { name: 'startup' }
  | { name: 'system-info' }
  | { name: 'uninstall' }
  | { name: 'dev-cleanup'; root: string };

function navFor(view: View): NavKey {
  switch (view.name) {
    case 'dev-cleanup':
      return 'dev-cleanup';
    case 'uninstall':
      return 'uninstall';
    case 'startup':
      return 'startup';
    case 'system-info':
      return 'system-info';
    default:
      return 'dashboard';
  }
}

export function App({ api }: AppProps) {
  const [view, setView] = useState<View>({ name: 'home' });
  const [quickCleanOpen, setQuickCleanOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemRoot, setSystemRoot] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [startupNotice, setStartupNotice] = useState<StartupNotice | null>(null);
  const [uninstallHint, setUninstallHint] = useState<UninstallLaunchHint | null>(null);
  const launchHandled = useRef(false);
  const usedByRoot = useRef(new Map<string, number | null>());

  useEffect(
    () =>
      api.onScanEvent((next) => {
        const startedAt = performance.now();
        recordRendererSample('app.event', performance.now() - startedAt);
        bumpRendererCount(`app.event.${next.type}`);
      }),
    [api],
  );

  useEffect(() => {
    if (launchHandled.current) return;
    launchHandled.current = true;
    api
      .getStartupLaunchHint()
      .then((hint) => {
        if (hint === null || !hint.open) return;
        setStartupNotice(hint.notice);
        setView({ name: 'startup' });
      })
      .catch(() => {});
    api
      .getUninstallLaunchHint()
      .then((hint) => {
        if (hint === null || !hint.open) return;
        setUninstallHint(hint);
        setView({ name: 'uninstall' });
      })
      .catch(() => {});
  }, [api]);

  const scan = useCallback(
    async (root: string, usedBytes: number | null): Promise<StartAnalyzeResult> => {
      usedByRoot.current.set(root.toLowerCase(), usedBytes);
      const result = await api.startAnalyze(root);
      if (result.ok) {
        setScanError(null);
        setView({ name: 'scan', root, runId: result.runId, usedBytes });
      }
      return result;
    },
    [api],
  );

  const rescan = useCallback(
    (root: string) => {
      void scan(root, usedByRoot.current.get(root.toLowerCase()) ?? null).then((result) => {
        if (!result.ok && result.reason !== 'busy') setScanError(result.message);
      });
    },
    [scan],
  );

  const home = useCallback(() => setView({ name: 'home' }), []);

  const viewResults = useCallback((root: string, category: CategoryId | null = null) => {
    setQuickCleanOpen(false);
    setView({ name: 'results', root, category });
  }, []);

  const openTool = useCallback(
    (tool: ToolKey | NavKey) => {
      if (tool === 'dashboard') setView({ name: 'home' });
      else if (tool === 'startup') setView({ name: 'startup' });
      else if (tool === 'system-info') setView({ name: 'system-info' });
      else if (tool === 'uninstall') setView({ name: 'uninstall' });
      else if (tool === 'dev-cleanup' && systemRoot !== null) setView({ name: 'dev-cleanup', root: systemRoot });
    },
    [systemRoot],
  );

  let content;
  if (view.name === 'scan') {
    content = (
      <ScanProgress
        key={view.runId}
        api={api}
        root={view.root}
        runId={view.runId}
        usedBytes={view.usedBytes}
        onFinished={(root) => viewResults(root)}
        onFailed={(message) => {
          setScanError(message);
          home();
        }}
      />
    );
  } else if (view.name === 'results') {
    content = (
      <ResultsPage
        key={view.root}
        api={api}
        root={view.root}
        initialCategory={view.category}
        onRescan={rescan}
        onBack={home}
        onOpenDevCleanup={(root) => setView({ name: 'dev-cleanup', root })}
      />
    );
  } else if (view.name === 'startup') {
    content = <StartupView api={api} notice={startupNotice} onNoticeShown={() => setStartupNotice(null)} />;
  } else if (view.name === 'system-info') {
    content = <SystemInfoView api={api} />;
  } else if (view.name === 'uninstall') {
    content = <UninstallView api={api} hint={uninstallHint} onHintShown={() => setUninstallHint(null)} />;
  } else if (view.name === 'dev-cleanup') {
    content = <DevCleanupView api={api} root={view.root} onBack={home} onViewResults={viewResults} />;
  } else {
    content = (
      <>
        {scanError !== null && (
          <div className="mx-auto max-w-5xl px-6 pt-6 sm:px-10">
            <p role="alert" className="rounded-xl bg-grade-danger-soft px-4 py-3 text-sm text-grade-danger">
              The scan stopped: {scanError}
            </p>
          </div>
        )}
        <HomeView
          api={api}
          onScan={scan}
          onViewResults={viewResults}
          onQuickClean={() => setQuickCleanOpen(true)}
          onOpenTool={openTool}
          onSystemDrive={setSystemRoot}
        />
      </>
    );
  }

  return (
    <div className="dust-dashboard flex h-screen overflow-hidden bg-canvas text-ink">
      <Sidebar
        active={navFor(view)}
        devCleanupDisabled={systemRoot === null}
        onNavigate={openTool}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="min-w-0 flex-1 overflow-y-auto">{content}</div>
      {quickCleanOpen && (
        <QuickCleanView api={api} onDone={() => setQuickCleanOpen(false)} onViewResults={viewResults} />
      )}
      {settingsOpen && <SettingsDialog api={api} onClose={() => setSettingsOpen(false)} />}
      <UpdateBanner api={api} />
    </div>
  );
}
