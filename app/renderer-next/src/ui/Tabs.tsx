import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...rest }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex gap-1 border-b border-border', className)} {...rest} />;
}

export function TabsTrigger({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'dur-faster -mb-px h-10 border-b-2 border-transparent px-3 text-body text-ink-2 transition-colors',
        'hover:text-ink data-[state=active]:border-accent data-[state=active]:font-semibold data-[state=active]:text-ink',
        className,
      )}
      {...rest}
    />
  );
}

export function TabsContent({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('pt-4', className)} {...rest} />;
}
