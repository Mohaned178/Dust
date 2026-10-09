import { describe, expect, it } from 'vitest';
import { plainReason, projectSubline } from '../../../renderer/src/lib/developer';
import { makeDevProject } from '../../renderer/fakes';

describe('developer helpers', () => {
  it('says why a project is not offered in plain words, never in engine terms', () => {
    const reasons = [
      'part of an installed app — not offered',
      'global install root — not offered (Phase 2)',
      'pnpm is not supported — Phase 2',
      'yarn 3 (Berry) is not supported — Phase 2',
      "Yarn Plug'n'Play project — no node_modules to clean",
      'no manifest or lockfile found — node_modules cannot be recreated',
      'something new — Phase 3',
    ];
    const plain = reasons.map(plainReason);
    expect(plain).toEqual([
      'Part of an installed app. Deleting it could break that app.',
      'Part of a global install. Deleting it could break those tools.',
      'Dust cannot rebuild pnpm projects yet.',
      'Dust cannot rebuild yarn 3 (Berry) projects yet.',
      'Uses Yarn Plug’n’Play, so there is no node_modules to clean.',
      'Nothing here to rebuild it from.',
      'Something new.',
    ]);
    for (const line of plain) expect(line).not.toMatch(/phase/i);
  });

  it('joins several reasons once each', () => {
    const project = makeDevProject({
      offered: false,
      reasons: ['part of an installed app — not offered', 'no manifest or lockfile found — cannot be recreated'],
    });
    expect(projectSubline(project)).toBe(
      'Part of an installed app. Deleting it could break that app. Nothing here to rebuild it from.',
    );
  });
});
