import { useState } from 'react';
import type { ReactNode } from 'react';
import type { UpdateStatus } from '../../../../src/shared/ipc';
import { useApi } from '../../lib/api';
import { useAppsStore } from '../../stores/apps';
import { useUpdatesStore } from '../../stores/updates';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { CopyLine } from '../../ui/CopyLine';
import { Notice } from '../../ui/Notice';
import { PageHeader } from '../../ui/PageHeader';
import { ProgressBar } from '../../ui/ProgressBar';

/** Where Dust's source code and releases are, as built into the app's updater. */
export const SOURCE_URL = 'https://github.com/Mohaned178/Dust';
/** Where Dust keeps its saved scan, its settings and its error log. */
export const DATA_FOLDER = '%APPDATA%\\Dust';

const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development build';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-t border-border py-2">
      <dt className="text-body text-ink-2">{label}</dt>
      <dd className="text-right text-body">{children}</dd>
    </div>
  );
}

/** What the updater is doing, in plain words. */
export function updateText(status: UpdateStatus): string {
  switch (status.phase) {
    case 'checking':
      return 'Checking for a new version.';
    case 'available':
      return `Dust ${status.version ?? 'has an update'} is available. Downloading it now.`;
    case 'downloading':
      return `Downloading Dust ${status.version ?? 'update'}${status.percent === null ? '' : `, ${status.percent}%`}.`;
    case 'downloaded':
      return `Dust ${status.version ?? 'update'} is ready. Restart Dust to finish updating.`;
    case 'up-to-date':
      return 'You have the latest version.';
    case 'error':
      return 'Dust could not check for updates. Check your internet connection and try again.';
    case 'idle':
      return status.message !== null
        ? 'Updates are available in the installed version of Dust.'
        : 'Dust looks for a new version a few seconds after it starts.';
  }
}

export function SettingsPage() {
  const api = useApi();
  const status = useUpdatesStore((state) => state.status);
  const applist = useAppsStore((state) => state.list.data);
  const [checking, setChecking] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Known only once the Apps page has read the list; until then the button is offered.
  const elevated = applist?.ok === true && applist.elevated;
  const busy = checking || status.phase === 'checking' || status.phase === 'downloading';

  const check = () => {
    setChecking(true);
    // The result also arrives as an event, which updates the status shown here.
    void api
      .checkForUpdates()
      .catch(() => {})
      .finally(() => setChecking(false));
  };

  const relaunch = () => {
    setRelaunching(true);
    setProblem(null);
    api.relaunchElevated().catch(() => {
      setRelaunching(false);
      setProblem('Dust could not restart with administrator rights. Nothing was changed.');
    });
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="About Dust, permissions and updates." />
      <div className="flex max-w-3xl flex-col gap-4">
        <Card role="region" aria-labelledby="settings-about">
          <CardHeader title={<span id="settings-about">About</span>} />
          <dl className="px-4 pb-3">
            <Row label="Version">{VERSION}</Row>
            <Row label="License">MIT. Dust is open source.</Row>
            <Row label="Source code">
              <span className="font-mono text-caption">{SOURCE_URL.replace('https://', '')}</span>
            </Row>
          </dl>
          <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
            <h3 className="text-body font-semibold">Your privacy</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink-2">
              <li>Dust runs on this PC. It has no account.</li>
              <li>It sends no usage data and has no telemetry.</li>
              <li>
                The only place it connects to is GitHub, to look for new versions and to download one when there is one.
              </li>
              <li>Nothing is deleted until you confirm it.</li>
              <li>Your saved scan and an error log are kept on this PC, in the folder below.</li>
            </ul>
            <CopyLine text={DATA_FOLDER} label="Copy the folder where Dust keeps its files" />
            <CopyLine text={SOURCE_URL} label="Copy the link to Dust's source code" />
          </div>
        </Card>

        <Card role="region" aria-labelledby="settings-permissions">
          <CardHeader title={<span id="settings-permissions">Administrator access</span>} />
          <div className="flex items-center justify-between gap-4 px-4 pb-4">
            <p className="text-body text-ink-2">
              {elevated
                ? 'Dust is running as administrator, so it can clean system locations and change startup entries for every user.'
                : 'Some items, such as Windows’ own temporary files and startup entries for every user, can only be changed when Dust runs as administrator. You only need this if Dust tells you so.'}
            </p>
            {elevated ? null : (
              <Button variant="secondary" loading={relaunching} onClick={relaunch}>
                Relaunch as administrator
              </Button>
            )}
          </div>
          {problem !== null ? (
            <div className="px-4 pb-4">
              <Notice variant="warning">{problem}</Notice>
            </div>
          ) : null}
        </Card>

        <Card role="region" aria-labelledby="settings-updates">
          <CardHeader
            title={<span id="settings-updates">Updates</span>}
            actions={
              status.phase === 'downloaded' ? (
                <Button variant="primary" onClick={() => void api.installUpdate()}>
                  Restart to update
                </Button>
              ) : (
                <Button variant="secondary" loading={busy} onClick={check}>
                  Check for updates
                </Button>
              )
            }
          />
          <div className="flex flex-col gap-2 px-4 pb-4" role="status">
            <p className="text-body text-ink-2">{updateText(status)}</p>
            {status.phase === 'downloading' ? (
              <ProgressBar
                value={status.percent === null ? null : status.percent / 100}
                label="Downloading the update"
              />
            ) : null}
            {status.phase === 'error' && status.message !== null ? (
              <details className="text-caption text-ink-2">
                <summary className="cursor-pointer">Details</summary>
                <p className="mt-1 font-mono break-all">{status.message}</p>
              </details>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}
