import { bsPrice, d1d2, intrinsic, type BsInputs } from './blackScholes.js';
import { normCdf, normPdf } from './normal.js';

export interface Greeks {
  /** ∂price/∂spot. */
  delta: number;
  /** ∂²price/∂spot². */
  gamma: number;
  /** ∂price/∂t as **daily** decay (per calendar day). */
  theta: number;
  /** ∂price/∂σ per **1%** (one vol point) change in IV. */
  vega: number;
  /** ∂price/∂r per **1%** change in rate. */
  rho: number;
}

/** Full Greeks for a single option in trader-friendly units. */
export function bsGreeks(i: BsInputs): Greeks {
  if (i.timeYears <= 0 || i.iv <= 0 || i.spot <= 0) {
    const itm = intrinsic(i.type, i.spot, i.strike) > 0;
    return {
      delta: itm ? (i.type === 'CALL' ? 1 : -1) : 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    };
  }

  const { d1, d2, sqrtT } = d1d2(i);
  const pdf = normPdf(d1);
  const disc = Math.exp(-i.rate * i.timeYears);

  const delta = i.type === 'CALL' ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (i.spot * i.iv * sqrtT);
  const vegaRaw = i.spot * pdf * sqrtT; // per 1.00 change in σ

  const term1 = -(i.spot * pdf * i.iv) / (2 * sqrtT);
  const thetaAnnual =
    i.type === 'CALL'
      ? term1 - i.rate * i.strike * disc * normCdf(d2)
      : term1 + i.rate * i.strike * disc * normCdf(-d2);

  const rhoRaw =
    i.type === 'CALL'
      ? i.strike * i.timeYears * disc * normCdf(d2)
      : -i.strike * i.timeYears * disc * normCdf(-d2);

  return {
    delta,
    gamma,
    theta: thetaAnnual / 365, // daily
    vega: vegaRaw / 100, // per 1% IV
    rho: rhoRaw / 100, // per 1% rate
  };
}

/** Price + Greeks in one call. */
export function priceAndGreeks(i: BsInputs): { price: number; greeks: Greeks } {
  return { price: bsPrice(i), greeks: bsGreeks(i) };
}
