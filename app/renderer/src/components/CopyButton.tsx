import { useEffect, useRef, useState } from 'react';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export interface CopyButtonProps {
  text: string;
  label: string;
}

export function CopyButton({ text, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const copy = () => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : label}
      onClick={copy}
      className={`shrink-0 rounded-lg border border-hairline bg-surface px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-hover ${FOCUS}`}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
