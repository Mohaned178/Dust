import { UNINSTALL_PHASES, keptReasonText } from '../uninstall';

export type PhaseStatus = 'pending' | 'started' | 'done' | 'failed' | 'skipped';

export interface PhaseState {
  status: PhaseStatus;
  note?: string;
}

export interface UninstallPhaseListProps {
  states: Record<string, PhaseState>;
}

function Marker({ status }: { status: PhaseStatus }) {
  if (status === 'started') {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-accent border-t-transparent motion-safe:animate-spin"
      />
    );
  }
  if (status === 'done') {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong"
      >
        <svg
          viewBox="0 0 12 12"
          className="h-2.5 w-2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m2.5 6.2 2.4 2.3L9.5 3.6" />
        </svg>
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-notice-border bg-notice text-[0.6rem] font-semibold text-accent-strong"
      >
        !
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas"
      >
        <span className="h-px w-2 bg-hairline" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-track" />
    </span>
  );
}

export function UninstallPhaseList({ states }: UninstallPhaseListProps) {
  return (
    <ol aria-label="Removal progress" aria-live="polite" className="space-y-2.5">
      {UNINSTALL_PHASES.map((phase) => {
        const state = states[phase.id] ?? { status: 'pending' as const };
        return (
          <li key={phase.id} className="flex items-start gap-3">
            <Marker status={state.status} />
            <div className="min-w-0">
              <p className={`text-sm ${state.status === 'pending' ? 'text-ink-muted' : 'text-ink'}`}>{phase.label}</p>
              {state.note !== undefined && (
                <p className="mt-0.5 text-xs text-ink-muted">{keptReasonText(state.note)}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
