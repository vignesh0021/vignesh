import { niceStrikeStep, type MarketAsset } from '../constants/instruments';
import type { Strategy } from '../constants/strategies';
import { bsPrice } from '../hooks/useBlackScholes';
import type { NewPositionInput } from '../store/usePortfolioStore';
import { addDaysIso, daysBetween, todayIso } from './format';

/**
 * Turn a strategy template into concrete legs for the current asset: strikes
 * snapped around ATM by the instrument's step, a near monthly expiry (plus any
 * per-leg calendar offset), and fair entry premiums priced off the default IV
 * so the freshly-applied position starts near breakeven.
 */
export function buildStrategyLegs(
  strategy: Strategy,
  asset: MarketAsset,
  spot: number,
  defaultIv: number,
  rate: number,
  nearDte = 30,
): NewPositionInput[] {
  const step = asset.strikeStep > 0 ? asset.strikeStep : niceStrikeStep(spot);
  const atm = Math.round(spot / step) * step;
  const today = todayIso();
  const nearExpiry = addDaysIso(today, nearDte);

  return strategy.legs.map((leg) => {
    const strike = Math.max(atm + leg.stepOffset * step, step);
    const expiry = leg.dteOffset ? addDaysIso(nearExpiry, leg.dteOffset) : nearExpiry;
    const days = Math.max(daysBetween(today, expiry), 1);
    const premium = bsPrice({
      spot,
      strike,
      timeYears: days / 365,
      rate,
      iv: Math.max(defaultIv, 0.01),
      type: leg.type,
    });
    return {
      instrument: asset.symbol,
      type: leg.type,
      action: leg.action,
      strike,
      expiry,
      entryPremium: Math.max(premium, 0),
      lots: leg.ratio,
      lotSize: asset.lotSize,
      iv: Math.max(defaultIv, 0.01),
    };
  });
}
