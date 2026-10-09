import { lazy, Suspense, useState } from 'react';
import { useToastStore } from '../ui/toast-store';

// The toast machinery (Radix Toast and friends) is a sizeable chunk, and most sessions never raise a toast, so it
// loads when the first one is pushed. The toast waits in the store until the host mounts.
const ToastHost = lazy(() => import('../ui/Toast').then((m) => ({ default: m.ToastHost })));

export function ToastLayer() {
  const hasToasts = useToastStore((state) => state.toasts.length > 0);
  const [wanted, setWanted] = useState(false);
  if (hasToasts && !wanted) setWanted(true);
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <ToastHost />
    </Suspense>
  );
}
