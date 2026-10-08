import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Shared building blocks for the redesigned screens: one button family, one
// card, one meter, so every page reads as the same product.

export const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'lg' | 'sm';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong shadow-[0_1px_2px_rgba(15,110,110,0.25)]',
  secondary: 'border border-hairline bg-surface text-ink hover:border-hairline-strong hover:bg-surface-hover',
  ghost: 'text-accent hover:bg-accent-soft',
  danger: 'bg-grade-danger text-white hover:brightness-95',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'gap-1.5 rounded-lg px-3 py-1.5 text-xs',
  md: 'gap-2 rounded-lg px-4 py-2 text-sm',
  lg: 'gap-2 rounded-xl px-6 py-3 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${SIZES[size]} ${FOCUS} ${className}`}
      {...rest}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-hairline bg-surface shadow-card ${className}`}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {subtitle !== undefined && <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-base font-semibold tracking-tight text-ink">{children}</h2>
      {aside}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'review' | 'danger';
}) {
  const tones = {
    neutral: 'bg-canvas text-ink-muted border-hairline',
    accent: 'bg-accent-soft text-accent-strong border-accent-border',
    review: 'bg-grade-review-soft text-grade-review border-transparent',
    danger: 'bg-grade-danger-soft text-grade-danger border-transparent',
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Horizontal usage meter. `value` and `max` in the same unit; `tone` picks the fill. */
export function Meter({
  value,
  max,
  label,
  tone = 'accent',
  className = 'h-2',
}: {
  value: number;
  max: number;
  label: string;
  tone?: 'accent' | 'review' | 'danger';
  className?: string;
}) {
  const percent = max > 0 ? Math.min(Math.max((value / max) * 100, 0), 100) : 0;
  const fill = tone === 'danger' ? 'bg-grade-danger-dot' : tone === 'review' ? 'bg-grade-review-dot' : 'bg-accent';
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className={`w-full overflow-hidden rounded-full bg-track ${className}`}
    >
      <div className={`dust-bar-fill h-full rounded-full ${fill}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Circular progress ring; `percent` null renders an indeterminate sweep. */
export function ProgressRing({
  percent,
  size = 168,
  children,
}: {
  percent: number | null;
  size?: number;
  children?: ReactNode;
}) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = percent === null ? 0.25 : Math.min(Math.max(percent, 0), 100) / 100;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden
        className={percent === null ? 'animate-spin [animation-duration:1.6s]' : undefined}
      >
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-track)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 400ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string; icon?: ReactNode }>;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-xl border border-hairline bg-surface p-1">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${FOCUS} ${
              active ? 'bg-accent-soft text-accent-strong' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
