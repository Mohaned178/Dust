import { createElement, useCallback, useState } from 'react';
import { useApi } from '../lib/api';
import { BusyScanDialog } from './BusyScanDialog';
import { useDialogs } from './dialogs';
import { useNavStore } from './nav';

export interface ScanTarget {
  root: string;
  /** Used space on the drive, the denominator that turns bytes found into a percentage. */
  usedBytes: number | null;
}

/**
 * Starts a scan of the system drive and opens the scan screen. If another scan is running it asks first.
 * `starting` is true from the click until the backend answers; `error` holds a plain-words failure.
 */
export function useStartScan() {
  const api = useApi();
  const dialogs = useDialogs();
  const navigate = useNavStore((state) => state.navigate);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (target: ScanTarget, retried = false): Promise<void> => {
      setStarting(true);
      setError(null);
      try {
        const result = await api.startAnalyze(target.root);
        if (result.ok) {
          navigate('cleanup', { view: 'scan', root: target.root, runId: result.runId, usedBytes: target.usedBytes });
          return;
        }
        if (result.reason !== 'busy') {
          setError(result.message);
          return;
        }
        if (retried) {
          setError('The earlier scan is still stopping. Try again in a moment.');
          return;
        }
        dialogs.open(({ open, close }) =>
          createElement(BusyScanDialog, {
            open,
            onWait: close,
            onCancelAndScan: () => {
              close();
              void api
                .cancelScan()
                .catch(() => {})
                .then(() => start(target, true));
            },
          }),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setStarting(false);
      }
    },
    [api, dialogs, navigate],
  );

  return { start, starting, error, clearError: () => setError(null) };
}
