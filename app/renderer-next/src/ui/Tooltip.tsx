import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ReactElement } from 'react';

export function Tooltip({
  label,
  side = 'bottom',
  children,
}: {
  label: string;
  /** Which edge of the trigger it opens from. The icon rail uses `right`. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactElement;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className="dust-flyout z-50 max-w-72 rounded-control bg-ink px-2 py-1 text-caption text-on-accent shadow-flyout"
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
