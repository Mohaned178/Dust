import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

/** Shown when a scan is requested while another is running. */
export function BusyScanDialog({
  open,
  onWait,
  onCancelAndScan,
}: {
  open: boolean;
  onWait: () => void;
  onCancelAndScan: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onWait()}
      title="A scan is already running."
      description="Wait for it to finish, or stop it and start this one."
      footer={
        <>
          <Button variant="secondary" onClick={onWait}>
            Wait
          </Button>
          <Button variant="primary" onClick={onCancelAndScan}>
            Cancel it and scan
          </Button>
        </>
      }
    />
  );
}
