import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { DismissIcon, SearchIcon } from './icons';

export interface SearchBoxProps {
  /** Called with the settled text, `delay` ms after the last keystroke (immediately on clear). */
  onSearch: (query: string) => void;
  label: string;
  placeholder?: string;
  delay?: number;
  /** Ctrl+F focuses the box while it is mounted. */
  shortcut?: boolean;
  defaultValue?: string;
  className?: string;
}

export function SearchBox({
  onSearch,
  label,
  placeholder = 'Search',
  delay = 300,
  shortcut = true,
  defaultValue = '',
  className,
}: SearchBoxProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const onSearchRef = useRef(onSearch);
  const sentRef = useRef(defaultValue);

  useEffect(() => {
    onSearchRef.current = onSearch;
  });

  const send = (query: string) => {
    if (sentRef.current === query) return;
    sentRef.current = query;
    onSearchRef.current(query);
  };

  useEffect(() => {
    const timer = setTimeout(() => send(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  useEffect(() => {
    if (!shortcut) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shortcut]);

  const clear = () => {
    setValue('');
    send('');
    inputRef.current?.focus();
  };

  return (
    <div
      className={cn(
        'dur-faster flex h-8 w-72 items-center gap-2 rounded-control border border-border bg-surface px-2 transition-colors',
        'hover:border-border-strong focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent',
        className,
      )}
    >
      <SearchIcon className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        role="searchbox"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value !== '') {
            event.preventDefault();
            clear();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-ink-2"
      />
      {value !== '' ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="dur-faster flex size-5 shrink-0 items-center justify-center rounded-control text-ink-2 hover:bg-surface-hover"
        >
          <DismissIcon className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
