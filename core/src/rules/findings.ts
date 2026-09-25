export type CacheFindingKind = 'curated-leftover' | 'app-matched' | 'app-leftover' | 'unrecognized';

export interface CacheFinding {
  path: string;
  bytes: number;
  kind: CacheFindingKind;
  grade: 'safe' | 'review';
  label: string;
  reason: string;
}
