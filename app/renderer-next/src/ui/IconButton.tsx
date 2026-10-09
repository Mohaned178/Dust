import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../lib/cn';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Sets both the accessible name and the tooltip. */
  label: string;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ label, children, className, type = 'button', ref, ...rest }: IconButtonProps) {
  return (
    <Tooltip label={label}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={cn(
          'dur-faster inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-2 transition-colors',
          'hover:bg-surface-hover hover:text-accent active:bg-surface-pressed disabled:pointer-events-none disabled:opacity-50',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
}
