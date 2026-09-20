import { classifyProjects } from '../../projects/classify';
import type { ProjectOptions, ProjectRecord } from '../../projects/types';
import type { Rule, RuleContext, RuleMatch } from '../types';

export function npmProjectModulesRule(options: ProjectOptions = {}): Rule {
  return {
    id: 'npm-project-modules',
    category: 'npm-projects',
    title: 'Project node_modules',
    action: { kind: 'delete-path' },
    match(ctx: RuleContext): RuleMatch[] {
      const now = (options.now ?? Date.now)();
      const analysis = classifyProjects({
        root: ctx.root,
        tree: ctx.tree,
        markers: ctx.markers,
        probe: ctx.probe,
        ...options,
      });

      const matches: RuleMatch[] = [];
      for (const project of analysis.projects) {
        if (!project.offered) continue;
        for (const location of project.nodeModules.paths) {
          matches.push({
            path: location.path,
            bytes: location.bytes,
            grade: project.restorability.grade === 'green' ? 'safe' : 'review',
            recovery: project.restorability.restoreCommand
              ? { kind: 'regenerate', command: project.restorability.restoreCommand }
              : { kind: 'junk', reason: 'No manifest found — node_modules cannot be recreated' },
            evidence: buildEvidence(project, now),
          });
        }
      }
      return matches;
    },
  };
}

function buildEvidence(project: ProjectRecord, now: number): string {
  const parts: string[] = [];
  parts.push(project.kind === 'monorepo' ? `Monorepo · ${project.workspaceCount} packages` : 'Project');
  parts.push(capitalize(project.recency));
  if (project.activity.ms !== null) {
    const days = Math.floor((now - project.activity.ms) / (24 * 60 * 60 * 1000));
    parts.push(`${Math.max(days, 0)}d ago (${project.activity.source})`);
  }
  if (project.restorability.restoreCommand) {
    parts.push(`restore: ${project.restorability.restoreCommand}`);
  }
  for (const reason of project.restorability.reasons) parts.push(reason);
  if (project.kind === 'orphaned-node-modules') parts.push('cannot be recreated');
  return parts.join(' · ');
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
