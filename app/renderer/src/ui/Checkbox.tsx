import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { CheckIcon, MinusIcon } from './icons';

export type CheckedState = boolean | 'indeterminate';

interface CheckboxBaseProps {
  checked: CheckedState;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/** Visible text is the accessible name; without it, `aria-label` is required. */
export type CheckboxProps = CheckboxBaseProps &
  ({ label: ReactNode; 'aria-label'?: string } | { label?: undefined; 'aria-label': string });

export function Checkbox({ checked, onCheckedChange, disabled, className, id, label, ...rest }: CheckboxProps) {
  const box = (
    <CheckboxPrimitive.Root
      id={id}
      checked={checked}
      disabled={disabled}
      aria-label={rest['aria-label']}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      className={cn(
        'dur-faster flex size-5 shrink-0 items-center justify-center rounded-control border transition-colors',
        'border-border-strong bg-surface hover:bg-surface-hover',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-on-accent',
        'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-on-accent',
        'disabled:pointer-events-none disabled:opacity-50',
        label === undefined && className,
      )}
    >
      <CheckboxPrimitive.Indicator>
        {checked === 'indeterminate' ? <MinusIcon className="size-4" /> : <CheckIcon className="size-4" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (label === undefined) return box;
  return (
    <label className={cn('inline-flex items-center gap-2 text-body', disabled && 'opacity-50', className)}>
      {box}
      <span>{label}</span>
    </label>
  );
}
