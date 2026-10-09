import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '../lib/cn';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Accessible name. Say what turns on, e.g. "Start Spotify with Windows". */
  label: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onCheckedChange, label, disabled, className }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'dur-faster relative inline-flex h-5 w-10 shrink-0 items-center rounded-full border transition-colors',
        'border-ink-3 bg-transparent data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'dur-faster pointer-events-none block size-3 rounded-full bg-ink-3 transition-transform',
          'translate-x-1 data-[state=checked]:translate-x-6 data-[state=checked]:bg-on-accent',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
