import { Link } from 'react-router-dom';

/** Honest roadmap signpost for modules not yet built (not a fake feature). */
export function ComingInMilestone({ name, milestone }: { name: string; milestone: string }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center rounded-lg border border-border bg-surface px-6 py-16 text-center">
      <span className="rounded-md border border-brand px-2 py-0.5 font-mono text-xs font-semibold text-brand">
        {milestone}
      </span>
      <h1 className="mt-4 text-xl font-bold">{name}</h1>
      <p className="mt-2 text-sm text-muted">
        This module is scheduled for milestone {milestone} of the build. The foundation it runs on —
        the options engine, design system and shared contracts — is already in place and tested.
      </p>
      <Link to="/" className="mt-6 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-[#0B0E11]">
        Back to Dashboard
      </Link>
    </div>
  );
}
