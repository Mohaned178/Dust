import type { DevGroup } from '../../../../src/shared/ipc';
import { cn } from '../../lib/cn';
import { BANDS, bytesOf, isSelectable } from '../../lib/developer';
import { formatBytes, formatCount } from '../../lib/format';
import { Badge } from '../../ui/Badge';
import { Checkbox } from '../../ui/Checkbox';
import { ChevronRightIcon } from '../../ui/icons';

export interface GroupRowProps {
  group: DevGroup;
  expanded: boolean;
  selected: ReadonlySet<string>;
  onSetMany: (paths: ReadonlyArray<string>, on: boolean) => void;
}

/** A group heading. The list row around it opens and closes on a click; the checkbox ticks everything in the group that can be. */
export function GroupRow({ group, expanded, selected, onSetMany }: GroupRowProps) {
  const band = BANDS[group.id];
  const selectable = group.projects.filter(isSelectable).map((project) => project.path);
  const chosen = selectable.filter((path) => selected.has(path)).length;
  const all = selectable.length > 0 && chosen === selectable.length;
  return (
    <div className="flex h-14 cursor-pointer items-center gap-3 border-t border-border bg-canvas px-4 first:border-t-0 hover:bg-surface-hover">
      <span className="flex w-5 shrink-0 justify-center" onClick={(event) => event.stopPropagation()}>
        {selectable.length > 0 ? (
          <Checkbox
            checked={all ? true : chosen > 0 ? 'indeterminate' : false}
            onCheckedChange={() => onSetMany(selectable, !all)}
            aria-label={`Select all in ${band.title}`}
          />
        ) : null}
      </span>
      <ChevronRightIcon className={cn('size-5 shrink-0 text-ink-2', expanded && 'rotate-90')} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="text-body font-semibold">{band.title}</span>
          <Badge>{formatCount(group.projects.length)}</Badge>
          <span className="hidden text-caption text-ink-2 sm:inline">{band.detail}</span>
        </p>
        <p className="truncate text-caption text-ink-2">{band.blurb}</p>
      </div>
      <span className="shrink-0 text-body font-semibold tabular-nums">{formatBytes(bytesOf(group.projects))}</span>
    </div>
  );
}
