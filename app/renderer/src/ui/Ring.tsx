import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface RingProps {
  /** 0 to 1. */
  value: number;
  /** Names the ring and its figure, e.g. "Memory in use, 61%". */
  label: string;
  size?: number;
  strokeWidth?: number;
  /** Shown in the middle, usually the figure. */
  children?: ReactNode;
  className?: string;
}

/** Drive, CPU and memory usage. It never transitions: values stream in and would smear. */
export function Ring({ value, label, size = 96, strokeWidth = 8, children, className }: RingProps) {
  const fraction = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  return (
    <div
      role="img"
      aria-label={label}
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-surface-pressed"
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${center} ${center})`}
          className="stroke-accent"
        />
      </svg>
      {children ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
      ) : null}
    </div>
  );
}
