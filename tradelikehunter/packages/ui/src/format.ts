/** Indian-locale number & money formatting (₹, lakh/crore grouping). */

function grouped(value: number, digits: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** e.g. formatINR(984220, 0) → "₹9,84,220". */
export function formatINR(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `${value < 0 ? '-' : ''}₹${grouped(Math.abs(value), digits)}`;
}

/** Signed number with an explicit + / − prefix, e.g. "+100.00", "-50.00". */
export function formatSigned(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : '-'}${grouped(Math.abs(value), digits)}`;
}

export function fmtNum(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return grouped(value, digits);
}
