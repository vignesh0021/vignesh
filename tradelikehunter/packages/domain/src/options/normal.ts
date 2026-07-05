/** Standard normal distribution helpers (no dependencies). */

const INV_SQRT_2PI = 0.3989422804014327; // 1 / sqrt(2π)

/** Standard normal probability density φ(x). */
export function normPdf(x: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

/**
 * Standard normal CDF N(x) via the Abramowitz & Stegun 7.1.26 erf
 * approximation. Maximum absolute error < 1.5e-7.
 */
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}
