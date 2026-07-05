import type { Leg } from '@tlh/domain';

/**
 * A sample NIFTY iron condor used to drive the Dashboard from the real options
 * engine until live paper-trading positions arrive in Milestone 1.
 */
export const DEMO_SPOT = 24180;
export const DEMO_RATE = 0.06;
export const DEMO_IV = 0.14;
export const STARTING_CAPITAL = 1_000_000;

const T = 20 / 365;
const LOT = 50;

export const demoBook: Leg[] = [
  { kind: 'OPTION', optType: 'CALL', action: 'SELL', strike: 24500, entryPrice: 121, size: LOT, iv: 0.13, timeYears: T },
  { kind: 'OPTION', optType: 'PUT', action: 'SELL', strike: 23800, entryPrice: 96, size: LOT, iv: 0.14, timeYears: T },
  { kind: 'OPTION', optType: 'CALL', action: 'BUY', strike: 24700, entryPrice: 60, size: LOT, iv: 0.14, timeYears: T },
  { kind: 'OPTION', optType: 'PUT', action: 'BUY', strike: 23600, entryPrice: 52, size: LOT, iv: 0.15, timeYears: T },
];

export function legLabel(leg: Leg): string {
  if (leg.kind === 'FUTURE') return 'FUT';
  return `${leg.optType === 'CALL' ? 'C' : 'P'} ${leg.strike}`;
}
