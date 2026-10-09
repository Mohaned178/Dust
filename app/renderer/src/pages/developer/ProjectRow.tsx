import type { DevProject } from '../../../../src/shared/ipc';
import { cn } from '../../lib/cn';
import { activitySourceText, isSelectable, projectSubline, quietFor } from '../../lib/developer';
import { formatBytes } from '../../lib/format';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { CodeIcon, LockIcon, PackageIcon } from '../../ui/icons';

export interface ProjectRowProps {
  project: DevProject;
  maxBytes: number;
  selected: boolean;
  onToggle: (path: string) => void;
  onPin: (project: DevProject, pinned: boolean) => void;
}

/** Says whether a project's folder can be brought back: a word and a dot, never colour alone. */
function RestorablePill({ grade }: { grade: 'green' | 'yellow' }) {
  const green = grade === 'green';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-semibold',
        green ? 'bg-safe-soft text-safe' : 'bg-review-soft text-review',
      )}
    >
      <span className={cn('size-1.5 rounded-full', green ? 'bg-safe' : 'bg-review')} aria-hidden="true" />
      {green ? 'Can be rebuilt' : 'Check first'}
    </span>
  );
}

export function ProjectRow({ project, maxBytes, selected, onToggle, onPin }: ProjectRowProps) {
  const selectable = isSelectable(project);
  const subline = projectSubline(project);
  const Icon = project.pinned ? LockIcon : project.kind === 'orphaned-node-modules' ? PackageIcon : CodeIcon;
  const share = maxBytes > 0 ? Math.max((project.nodeModulesBytes / maxBytes) * 100, 2) : 0;
  return (
    <div
      className={cn(
        'flex h-14 items-center gap-3 border-t border-border px-4 pl-9 hover:bg-surface-hover',
        selected && 'bg-accent-soft',
      )}
    >
      <span className="flex w-5 shrink-0 justify-center">
        {selectable ? (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggle(project.path)}
            aria-label={`Select ${project.name}`}
          />
        ) : null}
      </span>
      <Icon className="size-5 shrink-0 text-ink-2" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className={cn('truncate text-body font-semibold', project.pinned && 'text-ink-2')} title={project.path}>
            {project.name}
          </span>
          {project.kind === 'monorepo' ? (
            <Badge>{project.workspaceCount > 0 ? `${project.workspaceCount} workspaces` : 'Monorepo'}</Badge>
          ) : null}
          {project.packageManager.length > 0 && project.packageManager !== 'unknown' ? (
            <span className="hidden shrink-0 text-caption text-ink-2 md:inline">{project.packageManager}</span>
          ) : null}
        </p>
        <p className="truncate font-mono text-caption text-ink-2" title={subline}>
          {subline}
        </p>
      </div>
      <span
        className="hidden w-40 shrink-0 text-right text-caption text-ink-2 lg:block"
        title={activitySourceText(project)}
      >
        {quietFor(project.activityMs)}
      </span>
      <span
        className="hidden h-1 w-20 shrink-0 overflow-hidden rounded-control bg-surface-pressed sm:block"
        aria-hidden="true"
      >
        <span
          className={cn('block h-full', selectable ? 'bg-accent' : 'bg-border-strong')}
          style={{ width: `${share}%` }}
        />
      </span>
      <span className="w-20 shrink-0 text-right text-body font-semibold tabular-nums">
        {formatBytes(project.nodeModulesBytes)}
      </span>
      <span className="hidden w-32 shrink-0 justify-end md:flex">
        {project.pinned ? (
          <Badge>Kept</Badge>
        ) : project.offered ? (
          <RestorablePill grade={project.grade === 'yellow' ? 'yellow' : 'green'} />
        ) : (
          <Badge>Not offered</Badge>
        )}
      </span>
      <Button
        variant="subtle"
        aria-label={`${project.pinned ? 'Stop keeping' : 'Keep'} ${project.name}`}
        title={project.pinned ? 'Offer this project for cleanup again' : 'Never offer this project for cleanup'}
        onClick={() => onPin(project, !project.pinned)}
      >
        {project.pinned ? 'Stop keeping' : 'Keep'}
      </Button>
    </div>
  );
}
