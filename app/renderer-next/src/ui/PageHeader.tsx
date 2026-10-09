import type { ReactNode, Ref } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
  headingRef,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** The shell moves focus here after navigation. */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <header className="flex items-start justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 ref={headingRef} tabIndex={-1} className="text-title outline-none">
          {title}
        </h1>
        {subtitle ? <p className="mt-1 text-body text-ink-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
