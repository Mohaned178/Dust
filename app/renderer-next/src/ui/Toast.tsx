import { Toast as ToastPrimitive } from 'radix-ui';
import { create } from 'zustand';
import { Button } from './Button';
import { DismissIcon } from './icons';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  title: string;
  description?: string;
  /** For example Undo. Running it also dismisses the toast. */
  action?: ToastAction;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (options) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { ...options, id }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** `const toast = useToast(); toast({ title: 'Startup entry turned off', action: { label: 'Undo', onAction } })` */
export function useToast(): (options: ToastOptions) => number {
  return useToastStore((state) => state.push);
}

export const TOAST_DURATION_MS = 5000;

/** Mount once near the app root. Toasts are announced politely and never take focus. */
export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  return (
    <ToastPrimitive.Provider duration={TOAST_DURATION_MS} label="Notifications">
      {toasts.map((toast) => (
        <ToastPrimitive.Root
          key={toast.id}
          type="background"
          duration={TOAST_DURATION_MS}
          onOpenChange={(open) => {
            if (!open) dismiss(toast.id);
          }}
          className="dust-toast flex items-center gap-3 rounded-overlay border border-border bg-surface py-2 pr-2 pl-4 shadow-flyout"
        >
          <div className="min-w-0 flex-1">
            <ToastPrimitive.Title className="text-body font-semibold">{toast.title}</ToastPrimitive.Title>
            {toast.description ? (
              <ToastPrimitive.Description className="text-caption text-ink-2">
                {toast.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          {toast.action ? (
            <ToastPrimitive.Action altText={toast.action.label} asChild onClick={toast.action.onAction}>
              <Button variant="subtle" className="text-accent">
                {toast.action.label}
              </Button>
            </ToastPrimitive.Action>
          ) : null}
          <ToastPrimitive.Close
            aria-label="Dismiss notification"
            className="dur-faster flex size-8 items-center justify-center rounded-control text-ink-2 hover:bg-surface-hover"
          >
            <DismissIcon className="size-4" aria-hidden="true" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}
