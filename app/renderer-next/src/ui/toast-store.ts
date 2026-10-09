import { create } from 'zustand';

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

export interface ToastItem extends ToastOptions {
  id: number;
}

export interface ToastStore {
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
