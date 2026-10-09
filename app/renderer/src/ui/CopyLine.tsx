import { IconButton } from './IconButton';
import { CopyIcon } from './icons';

/** A command in mono type with a button that copies it. `label` names the button for screen readers. */
export function CopyLine({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-start gap-1">
      <code className="min-w-0 flex-1 font-mono text-caption break-all">{text}</code>
      <IconButton label={label} onClick={() => void navigator.clipboard?.writeText(text).catch(() => {})}>
        <CopyIcon className="size-4" aria-hidden="true" />
      </IconButton>
    </div>
  );
}
