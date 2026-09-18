import type { Rule } from './types';

export class RuleValidationError extends Error {
  constructor(
    public readonly ruleId: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuleValidationError';
  }
}

export function validateRules(rules: Rule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!rule.id || rule.id.trim() === '') {
      throw new RuleValidationError(String(rule.id), 'rule id must be a non-empty string');
    }
    if (seen.has(rule.id)) {
      throw new RuleValidationError(rule.id, `duplicate rule id: ${rule.id}`);
    }
    seen.add(rule.id);
    if (!rule.title || rule.title.trim() === '') {
      throw new RuleValidationError(rule.id, `rule ${rule.id} must have a non-empty title`);
    }
  }
}
