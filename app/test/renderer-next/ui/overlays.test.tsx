import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../../../renderer-next/src/ui/Button';
import { ConfirmDialog, Dialog } from '../../../renderer-next/src/ui/Dialog';
import { TOAST_DURATION_MS, ToastHost, useToast, useToastStore } from '../../../renderer-next/src/ui/Toast';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Uninstall Spotify"
        description="You choose what to remove."
        footer={<Button onClick={() => setOpen(false)}>Done</Button>}
      >
        <input aria-label="Name" />
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('is named and described, moves focus in and returns it to the trigger on Escape', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Uninstall Spotify' });
    expect(dialog).toHaveAccessibleDescription('You choose what to remove.');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('traps Tab inside while open', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = await screen.findByRole('dialog');
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('closes with the corner button and returns focus', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('cannot be dismissed while it is not dismissible', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Deleting" dismissible={false}>
        Working
      </Dialog>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  it('names the action on the confirm button and runs it', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete 4.2 GB?"
        confirmLabel="Delete 4.2 GB"
        destructive
        onConfirm={onConfirm}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Delete 4.2 GB' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('locks both buttons and Escape while loading, and can disable confirm', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Clean"
        confirmLabel="Clean 1 GB"
        onConfirm={() => {}}
        loading
      />,
    );
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clean 1 GB' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
    rerender(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Clean"
        confirmLabel="Clean 1 GB"
        onConfirm={() => {}}
        confirmDisabled
      />,
    );
    expect(screen.getByRole('button', { name: 'Clean 1 GB' })).toBeDisabled();
  });
});

function ToastHarness({ onUndo }: { onUndo: () => void }) {
  const toast = useToast();
  return (
    <>
      <Button
        onClick={() =>
          toast({
            title: 'Startup entry turned off',
            description: 'Spotify will not start.',
            action: { label: 'Undo', onAction: onUndo },
          })
        }
      >
        Show
      </Button>
      <ToastHost />
    </>
  );
}

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers();
    act(() => useToastStore.setState({ toasts: [] }));
  });

  it('announces politely without taking focus, and Undo runs and dismisses', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    render(<ToastHarness onUndo={onUndo} />);
    const trigger = screen.getByRole('button', { name: 'Show' });
    await user.click(trigger);
    const title = await screen.findByText('Startup entry turned off');
    expect(title).toBeVisible();
    expect(screen.getByRole('region', { name: /Notifications/ })).toBeInTheDocument();
    // Screen readers hear it through a polite live region, not through focus.
    await waitFor(() => {
      const live = screen
        .getAllByRole('status')
        .find((element) => element.textContent?.includes('Startup entry turned off'));
      expect(live).toHaveAttribute('aria-live', 'polite');
    });
    expect(trigger).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('dismisses itself after five seconds', async () => {
    vi.useFakeTimers();
    render(<ToastHarness onUndo={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(TOAST_DURATION_MS).toBe(5000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOAST_DURATION_MS + 500);
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
