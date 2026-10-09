import { Suspense, lazy } from 'react';
import type { useDialogs } from '../../app/dialogs';
import type { ResumeFlowProps } from './ResumeFlow';
import type { UninstallWizardProps } from './UninstallWizard';

// Both are their own chunks, fetched the first time someone removes an app.
const UninstallWizard = lazy(() => import('./UninstallWizard').then((m) => ({ default: m.UninstallWizard })));
const ResumeFlow = lazy(() => import('./ResumeFlow').then((m) => ({ default: m.ResumeFlow })));

type Dialogs = Pick<ReturnType<typeof useDialogs>, 'open'>;

/** Opens the step-by-step removal of one app: its own uninstaller first, then what it left behind. */
export function openUninstallWizard(dialogs: Dialogs, props: Omit<UninstallWizardProps, 'open' | 'onClose'>): void {
  dialogs.open(({ open, close }) => (
    <Suspense fallback={null}>
      <UninstallWizard {...props} open={open} onClose={close} />
    </Suspense>
  ));
}

/** Opens the single-plan removal that Dust restarts into after it was relaunched as administrator. */
export function openResumeFlow(dialogs: Dialogs, props: Omit<ResumeFlowProps, 'open' | 'onClose'>): void {
  dialogs.open(({ open, close }) => (
    <Suspense fallback={null}>
      <ResumeFlow {...props} open={open} onClose={close} />
    </Suspense>
  ));
}
