import type { ReactNode } from 'react';
import { create } from 'zustand';

export interface DialogRenderProps {
  open: boolean;
  close: () => void;
}

interface DialogEntry {
  id: number;
  open: boolean;
  render: (props: DialogRenderProps) => ReactNode;
}

interface DialogStore {
  entries: DialogEntry[];
  /** Shows the dialog `render` returns. It receives `open` so the dialog can play its exit before it is removed. */
  open: (render: DialogEntry['render']) => number;
  close: (id: number) => void;
}

/** Long enough for the dialog exit animation (--dur-fast). */
export const DIALOG_EXIT_MS = 150;

let nextId = 1;

export const useDialogStore = create<DialogStore>()((set, get) => ({
  entries: [],
  open: (render) => {
    const id = nextId++;
    set((state) => ({ entries: [...state.entries, { id, open: true, render }] }));
    return id;
  },
  close: (id) => {
    if (!get().entries.some((entry) => entry.id === id && entry.open)) return;
    set((state) => ({ entries: state.entries.map((entry) => (entry.id === id ? { ...entry, open: false } : entry)) }));
    setTimeout(() => set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) })), DIALOG_EXIT_MS);
  },
}));

/**
 * `const dialogs = useDialogs(); dialogs.open(({ open, close }) => <ConfirmDialog open={open} onOpenChange={close} … />)`
 */
export function useDialogs(): Pick<DialogStore, 'open' | 'close'> {
  const open = useDialogStore((state) => state.open);
  const close = useDialogStore((state) => state.close);
  return { open, close };
}

/** Mount once near the app root. */
export function DialogHost() {
  const entries = useDialogStore((state) => state.entries);
  const close = useDialogStore((state) => state.close);
  return (
    <>
      {entries.map((entry) => (
        <DialogSlot key={entry.id} entry={entry} close={close} />
      ))}
    </>
  );
}

function DialogSlot({ entry, close }: { entry: DialogEntry; close: (id: number) => void }) {
  return <>{entry.render({ open: entry.open, close: () => close(entry.id) })}</>;
}

export function resetDialogStore(): void {
  useDialogStore.setState({ entries: [] });
}
