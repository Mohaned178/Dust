import { useRef, useState } from 'react';
import type { StartupEntry } from '../../../../src/shared/ipc';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Notice } from '../../ui/Notice';

export interface StartupAdminDialogProps {
  open: boolean;
  onClose: () => void;
  entry: StartupEntry;
  /** Restarts Dust with administrator rights. Rejects when Windows refuses; resolves just before Dust quits. */
  onRelaunch: () => Promise<void>;
}

/** Asked before changing an entry that belongs to every user on the PC. */
export function StartupAdminDialog({ open, onClose, entry, onRelaunch }: StartupAdminDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const relaunch = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRelaunch();
    } catch {
      setBusy(false);
      setError('Dust could not restart with administrator rights. Try again, or change it in Task Manager.');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !busy && onClose()}
      title="Administrator rights needed"
      description={`${entry.name} starts for everyone who uses this PC, so Windows only lets an administrator change it.`}
      dismissible={!busy}
      initialFocus={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void relaunch()}>
            Relaunch as administrator
          </Button>
        </>
      }
    >
      {error !== null ? <Notice variant="warning">{error}</Notice> : null}
    </Dialog>
  );
}

export interface StartupEnableDialogProps {
  open: boolean;
  onClose: () => void;
  entry: StartupEntry;
  /** Turns the entry on. Resolves with a plain-words problem, or null when it worked. */
  onConfirm: () => Promise<string | null>;
}

/** Asked before turning on an entry the user switched off in Windows' own startup settings. */
export function StartupEnableDialog({ open, onClose, entry, onConfirm }: StartupEnableDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const problem = await onConfirm().catch(() => 'Dust could not make this change.');
    if (problem === null) {
      onClose();
      return;
    }
    setBusy(false);
    setError(problem);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !busy && onClose()}
      title={`Turn on ${entry.name}?`}
      description="You turned this off in Windows' startup settings. Turning it on makes it run when you sign in."
      dismissible={!busy}
      initialFocus={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void confirm()}>
            {entry.requiresAdmin ? 'Relaunch and turn on' : 'Turn on'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {entry.requiresAdmin ? (
          <p className="text-body text-ink-2">This needs administrator rights, so Dust will restart first.</p>
        ) : null}
        {error !== null ? <Notice variant="warning">{error}</Notice> : null}
      </div>
    </Dialog>
  );
}
