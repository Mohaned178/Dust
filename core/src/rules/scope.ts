import { volumeRootOf } from '../system/drive-type';
import type { Rule } from './types';

export function scopeRuleToRoot(rule: Rule): Rule {
  return {
    ...rule,
    async match(ctx) {
      const matches = await rule.match(ctx);
      if (matches.length === 0) return matches;

      const rootVolume = volumeRootOf(ctx.root);
      if (rootVolume === null) return matches;

      const volume = rootVolume.toLowerCase();
      return matches.filter((match) => {
        const matchVolume = volumeRootOf(match.path);
        return matchVolume !== null && matchVolume.toLowerCase() === volume;
      });
    },
  };
}
