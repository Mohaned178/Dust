import { ToggleGroup } from 'radix-ui';
import { cn } from '../lib/cn';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Names the group, e.g. "Show startup apps". */
  label: string;
  className?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={label}
      // Radix reports an empty string when the selected item is pressed again; one option must stay selected.
      onValueChange={(next) => {
        if (next !== '') onChange(next as T);
      }}
      className={cn('inline-flex rounded-control border border-border bg-surface-hover p-0.5', className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            'dur-faster h-7 rounded-control px-3 text-body text-ink-2 transition-colors',
            'hover:text-ink data-[state=on]:bg-surface data-[state=on]:font-semibold data-[state=on]:text-ink data-[state=on]:shadow-card',
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
