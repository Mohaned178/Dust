import { Suspense, lazy } from 'react';
import type { useDialogs } from '../../app/dialogs';
import type { CleanDialogProps } from './CleanDialog';

// The dialog is its own chunk: it is fetched the first time someone starts a clean, not with the app.
const CleanDialog = lazy(() => import('./CleanDialog').then((m) => ({ default: m.CleanDialog })));

/** Opens the Clean dialog through the dialog host. */
export function openCleanDialog(
  dialogs: ReturnType<typeof useDialogs>,
  props: Omit<CleanDialogProps, 'open' | 'onClose'>,
): void {
  dialogs.open(({ open, close }) => (
    <Suspense fallback={null}>
      <CleanDialog {...props} open={open} onClose={close} />
    </Suspense>
  ));
}
