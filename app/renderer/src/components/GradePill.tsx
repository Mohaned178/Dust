import type { DisplayGrade } from '@dust/core';

export function gradeWord(grade: DisplayGrade): string {
  return grade === 'safe' ? 'Safe' : grade === 'review' ? 'Review' : 'Protected';
}

export function GradePill({ grade }: { grade: DisplayGrade }) {
  const style =
    grade === 'safe'
      ? 'bg-grade-safe-soft text-grade-safe'
      : grade === 'review'
        ? 'bg-grade-review-soft text-grade-review'
        : 'bg-grade-danger-soft text-grade-danger';
  const dot =
    grade === 'safe' ? 'bg-grade-safe-dot' : grade === 'review' ? 'bg-grade-review-dot' : 'bg-grade-danger-dot';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {gradeWord(grade)}
    </span>
  );
}

export function RestorabilityPill({ grade }: { grade: 'green' | 'yellow' }) {
  const style = grade === 'green' ? 'bg-grade-safe-soft text-grade-safe' : 'bg-grade-review-soft text-grade-review';
  const dot = grade === 'green' ? 'bg-grade-safe-dot' : 'bg-grade-review-dot';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {grade === 'green' ? 'Restorable' : 'Review'}
    </span>
  );
}
