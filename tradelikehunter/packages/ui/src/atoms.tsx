import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { formatINR, formatSigned } from './format.js';

type ButtonVariant = 'primary' | 'outline' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

/** Primary action control. Native `disabled` blocks clicks automatically. */
export function Button({ variant = 'primary', className = '', children, ...rest }: ButtonProps) {
  const base =
    'tlh-btn inline-flex items-center justify-center rounded-md font-semibold px-4 py-2 transition-colors duration-150';
  const look =
    variant === 'primary'
      ? 'bg-brand text-[#0B0E11] hover:opacity-90'
      : variant === 'outline'
        ? 'border border-border text-text hover:bg-surface-2'
        : 'text-muted hover:text-text';
  return (
    <button className={`${base} ${look} ${className} disabled:opacity-40`} {...rest}>
      {children}
    </button>
  );
}

/** Money value, right-aligned tabular figures. */
export function Money({ value, digits = 2, className = '' }: { value: number; digits?: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatINR(value, digits)}</span>;
}

/** Profit/loss text — green when ≥ 0, red when negative, with a signed prefix. */
export function PnlText({ value, digits = 2, className = '' }: { value: number; digits?: number; className?: string }) {
  const up = value >= 0;
  return (
    <span className={`tlh-pnl tabular-nums ${up ? 'text-profit' : 'text-loss'} ${className}`}>
      {formatSigned(value, digits)}
    </span>
  );
}

type Tone = 'neutral' | 'good' | 'bad' | 'warn';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  const c =
    tone === 'good'
      ? 'text-profit border-profit'
      : tone === 'bad'
        ? 'text-loss border-loss'
        : tone === 'warn'
          ? 'text-brand border-brand'
          : 'text-muted border-border';
  return (
    <span className={`tlh-badge inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${c}`}>
      {children}
    </span>
  );
}

/** Dashboard KPI tile: label + big value + optional delta line. */
export function StatTile({
  label,
  value,
  delta,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
}) {
  return (
    <div className="tlh-stat rounded-lg border border-border bg-surface p-4">
      <div className="text-muted text-xs uppercase tracking-wide">{label}</div>
      <div className="text-text mt-1 text-xl font-bold tabular-nums">{value}</div>
      {delta != null ? <div className="mt-1 text-xs">{delta}</div> : null}
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`tlh-spinner inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brand ${className}`}
    />
  );
}
