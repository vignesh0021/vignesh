export type MarketView = 'Bullish' | 'Bearish' | 'Neutral' | 'Volatile';

export interface StrategyLegTemplate {
  type: 'CALL' | 'PUT';
  action: 'BUY' | 'SELL';
  /** Strike offset from ATM in units of the instrument's strike step. */
  stepOffset: number;
  /** Size ratio relative to the base lot count. */
  ratio: number;
  /** Optional expiry offset (days) from the near expiry — for calendars. */
  dteOffset?: number;
}

export interface Adjustment {
  scenario: string;
  trigger: string;
  action: string;
  rationale: string;
}

export interface Strategy {
  id: string;
  name: string;
  view: MarketView;
  risk: string;
  legs: StrategyLegTemplate[];
  when: string;
  what: string;
  why: string;
  maxProfit: string;
  maxLoss: string;
  adjustments: Adjustment[];
}

/**
 * Predefined strategy playbook. Each entry carries the "when / what / why"
 * rationale plus a full adjustment guide covering the main scenarios a trade
 * can move into — not just a single repair.
 */
export const STRATEGIES: Strategy[] = [
  {
    id: 'bull-call-spread',
    name: 'Bull Call Spread',
    view: 'Bullish',
    risk: 'Defined risk / defined reward',
    legs: [
      { type: 'CALL', action: 'BUY', stepOffset: 0, ratio: 1 },
      { type: 'CALL', action: 'SELL', stepOffset: 4, ratio: 1 },
    ],
    when: 'Moderately bullish with a target near the short strike, and you want to cap cost. Best when IV is low-to-moderate (you are a net buyer of premium).',
    what: 'Buy an ATM call and sell a higher OTM call in the same expiry. A debit spread.',
    why: 'Selling the upper call finances part of the long call, lowering breakeven and capping cost vs a naked long call. Defined, cheap directional exposure.',
    maxProfit: 'Width of strikes − net debit (at/above the short strike).',
    maxLoss: 'Net debit paid (at/below the long strike).',
    adjustments: [
      { scenario: 'Underlying rallies to target early', trigger: 'Spread at 60–80% of max profit well before expiry', action: 'Close the whole spread and book profit, or roll both strikes up to extend the move.', rationale: 'Little reward left vs the gamma/reversal risk of holding to expiry.' },
      { scenario: 'Underlying drifts sideways', trigger: 'Price stalls, theta eroding the debit', action: 'Roll the short call down to collect more credit, or convert to a vertical closer to spot.', rationale: 'Reduces cost basis and breakeven while you wait for the move.' },
      { scenario: 'Underlying breaks down', trigger: 'Price falls below the long strike, thesis broken', action: 'Cut the spread; optionally sell a put spread to recover debit if now bearish.', rationale: 'Preserve the remaining debit rather than hoping for a reversal.' },
      { scenario: 'IV spikes in your favour', trigger: 'Sharp vol expansion with price up', action: 'Take profit — long vertical vega is small; the directional gain is the edge.', rationale: 'Verticals are near vega-neutral, so vol pops mostly help via the underlying move.' },
    ],
  },
  {
    id: 'bear-put-spread',
    name: 'Bear Put Spread',
    view: 'Bearish',
    risk: 'Defined risk / defined reward',
    legs: [
      { type: 'PUT', action: 'BUY', stepOffset: 0, ratio: 1 },
      { type: 'PUT', action: 'SELL', stepOffset: -4, ratio: 1 },
    ],
    when: 'Moderately bearish with a downside target near the short strike; cheaper than a naked long put.',
    what: 'Buy an ATM put and sell a lower OTM put in the same expiry. A debit spread.',
    why: 'The short put offsets premium and defines risk, giving controlled downside exposure with a known cost.',
    maxProfit: 'Width of strikes − net debit (at/below the short strike).',
    maxLoss: 'Net debit paid (at/above the long strike).',
    adjustments: [
      { scenario: 'Underlying drops to target', trigger: 'Near max profit with time left', action: 'Close for profit or roll strikes down to ride continuation.', rationale: 'Lock gains before a bounce erases them.' },
      { scenario: 'Sideways / slow bleed', trigger: 'Theta eating the debit', action: 'Roll the short put up toward spot to add credit.', rationale: 'Lowers cost basis while keeping the bearish tilt.' },
      { scenario: 'Underlying rallies against you', trigger: 'Price above the long put strike', action: 'Exit and, if reversing bullish, flip to a call spread.', rationale: 'Avoid full loss of the debit on a broken thesis.' },
      { scenario: 'Volatility collapses', trigger: 'IV crush with price flat', action: 'Consider closing — debit spreads lose slowly to vol drop and theta.', rationale: 'No edge left when both direction and vol work against you.' },
    ],
  },
  {
    id: 'bull-put-spread',
    name: 'Bull Put Spread (Put Credit)',
    view: 'Bullish',
    risk: 'Defined risk / credit received',
    legs: [
      { type: 'PUT', action: 'SELL', stepOffset: -2, ratio: 1 },
      { type: 'PUT', action: 'BUY', stepOffset: -6, ratio: 1 },
    ],
    when: 'Neutral-to-bullish and IV is elevated; you want to be paid for time decay with defined risk.',
    what: 'Sell an OTM put, buy a further OTM put for protection. A credit spread.',
    why: 'Collect premium that decays if price holds above the short strike. The long put caps the loss, so risk is defined.',
    maxProfit: 'Net credit received (price at/above short strike at expiry).',
    maxLoss: 'Width − credit (price at/below long strike).',
    adjustments: [
      { scenario: 'Price holds above short strike', trigger: 'Spread at ~50% of max profit', action: 'Close early to bank the credit and free up margin.', rationale: 'Best risk-adjusted exit; avoids late gamma risk.' },
      { scenario: 'Underlying tests the short put', trigger: 'Price nears/breaches the short strike', action: 'Roll the spread down and out (later expiry, lower strikes) for a credit to buy time and distance.', rationale: 'Keeps the trade net-credit while giving price room to recover.' },
      { scenario: 'Sharp breakdown through both strikes', trigger: 'Price below the long strike', action: 'Take the defined max loss or convert to a wider/further-dated spread for a credit.', rationale: 'Loss is already capped; do not add undefined risk to defend.' },
      { scenario: 'IV spikes', trigger: 'Vol expansion inflates the spread value', action: 'Hold if price is fine — elevated IV means richer roll credits; consider adding a call credit spread to form an iron condor.', rationale: 'High IV favours premium sellers and improves any roll.' },
    ],
  },
  {
    id: 'bear-call-spread',
    name: 'Bear Call Spread (Call Credit)',
    view: 'Bearish',
    risk: 'Defined risk / credit received',
    legs: [
      { type: 'CALL', action: 'SELL', stepOffset: 2, ratio: 1 },
      { type: 'CALL', action: 'BUY', stepOffset: 6, ratio: 1 },
    ],
    when: 'Neutral-to-bearish with elevated IV; get paid for decay with a capped loss.',
    what: 'Sell an OTM call, buy a further OTM call. A credit spread.',
    why: 'Premium decays if price stays below the short call. The long call defines the maximum loss.',
    maxProfit: 'Net credit (price at/below short strike at expiry).',
    maxLoss: 'Width − credit (price at/above long strike).',
    adjustments: [
      { scenario: 'Price stays below short call', trigger: '~50% of max profit reached', action: 'Close early and redeploy.', rationale: 'Capture most of the edge with less tail risk.' },
      { scenario: 'Underlying rallies into the short call', trigger: 'Price nears/breaches short strike', action: 'Roll up and out for a credit, or add a put credit spread to become an iron condor.', rationale: 'Distance + time, or rebalance deltas to neutral.' },
      { scenario: 'Runaway rally through both strikes', trigger: 'Price above long call', action: 'Accept capped max loss or roll to a later expiry for a credit.', rationale: 'Risk is already defined; do not chase with naked calls.' },
      { scenario: 'IV collapses', trigger: 'Vol crush with price flat/down', action: 'Close for accelerated profit.', rationale: 'Short vega gains quickly when IV falls.' },
    ],
  },
  {
    id: 'long-straddle',
    name: 'Long Straddle',
    view: 'Volatile',
    risk: 'Defined risk / large move needed',
    legs: [
      { type: 'CALL', action: 'BUY', stepOffset: 0, ratio: 1 },
      { type: 'PUT', action: 'BUY', stepOffset: 0, ratio: 1 },
    ],
    when: 'You expect a big move but are unsure of direction — before earnings, events, or a breakout — while IV is still cheap.',
    what: 'Buy an ATM call and an ATM put in the same expiry.',
    why: 'Profits from a large move either way and from rising IV. Long gamma and long vega.',
    maxProfit: 'Unlimited up, large down (to zero). Needs a move larger than the combined premium.',
    maxLoss: 'Total premium paid (price pins the strike at expiry).',
    adjustments: [
      { scenario: 'Big directional move happens', trigger: 'One leg deep ITM', action: 'Sell the winning leg or roll it into a spread; consider closing the loser.', rationale: 'Lock the move and remove decay drag from the losing leg.' },
      { scenario: 'Move stalls, time passing', trigger: 'Price near strike with theta biting', action: 'Convert to an iron butterfly by selling OTM wings, or cut losses.', rationale: 'Sell premium to offset the decay you are paying.' },
      { scenario: 'IV spikes without a move', trigger: 'Vol expansion pre-event', action: 'Consider closing into the vol pop, especially before the event de-risks.', rationale: 'Capture the vega gain before post-event IV crush.' },
      { scenario: 'Post-event IV crush', trigger: 'Event passes, IV collapses', action: 'Exit quickly if no move — the vega loss compounds theta.', rationale: 'Straddles bleed fast once the expected catalyst is gone.' },
    ],
  },
  {
    id: 'long-strangle',
    name: 'Long Strangle',
    view: 'Volatile',
    risk: 'Defined risk / cheaper than straddle',
    legs: [
      { type: 'CALL', action: 'BUY', stepOffset: 3, ratio: 1 },
      { type: 'PUT', action: 'BUY', stepOffset: -3, ratio: 1 },
    ],
    when: 'Expect a large move, want lower cost than a straddle, and can tolerate wider breakevens.',
    what: 'Buy an OTM call and an OTM put in the same expiry.',
    why: 'Cheaper long-gamma/long-vega bet; needs a bigger move than a straddle but risks less premium.',
    maxProfit: 'Unlimited up, large down. Requires a move beyond either strike plus premium.',
    maxLoss: 'Total premium paid (price between the strikes at expiry).',
    adjustments: [
      { scenario: 'Sharp move through a strike', trigger: 'One leg ITM', action: 'Roll the winner into a spread or sell it; drop the loser.', rationale: 'Bank directional profit, cut decay.' },
      { scenario: 'Range-bound drift', trigger: 'Theta erosion, no move', action: 'Sell nearer OTM options against each leg (turn into a condor/butterfly).', rationale: 'Collect premium to fund the position.' },
      { scenario: 'Vol expansion', trigger: 'IV rises pre-catalyst', action: 'Take vega profit before the event.', rationale: 'Avoid the post-event IV crush.' },
      { scenario: 'Approaching expiry, still centred', trigger: 'Few days left, price mid-range', action: 'Close for salvage value.', rationale: 'Gamma cannot save a position with no time and no move.' },
    ],
  },
  {
    id: 'short-strangle',
    name: 'Short Strangle',
    view: 'Neutral',
    risk: 'Undefined risk / high probability',
    legs: [
      { type: 'CALL', action: 'SELL', stepOffset: 3, ratio: 1 },
      { type: 'PUT', action: 'SELL', stepOffset: -3, ratio: 1 },
    ],
    when: 'Range-bound view with elevated IV; you want to harvest time decay. Requires margin and active management.',
    what: 'Sell an OTM call and an OTM put. Undefined risk both ways.',
    why: 'Collects premium that decays if price stays between the strikes; short vega benefits from IV mean-reversion.',
    maxProfit: 'Total credit received (price between strikes at expiry).',
    maxLoss: 'Undefined — large moves in either direction. Manage before that.',
    adjustments: [
      { scenario: 'One side is tested', trigger: 'Delta of tested short ~0.30+, price approaching it', action: 'Roll the untested side toward spot for more credit (defend deltas), or roll the tested side out.', rationale: 'Recentre the position and reduce net delta without buying it back at a loss.' },
      { scenario: 'Strong trend day', trigger: 'Price accelerating through a strike', action: 'Roll the tested strike out and up/down, or convert to an iron condor by buying wings to cap risk.', rationale: 'Cap catastrophic risk; buy time for mean reversion.' },
      { scenario: 'Profit target hit', trigger: '~50% of max credit captured', action: 'Close the whole position.', rationale: 'Best risk-adjusted exit; avoid holding through gamma into expiry.' },
      { scenario: 'IV spikes sharply', trigger: 'Vol expansion inflates both shorts', action: 'Add long wings (become an iron condor) or reduce size.', rationale: 'Protect against a vol-driven blowout while staying short premium.' },
      { scenario: 'Expiry week, price mid-range', trigger: 'Few days left, deltas small', action: 'Take profit rather than holding for the last few points.', rationale: 'Gamma risk rises fastest near expiry for short options.' },
    ],
  },
  {
    id: 'iron-condor',
    name: 'Iron Condor',
    view: 'Neutral',
    risk: 'Defined risk / credit received',
    legs: [
      { type: 'PUT', action: 'SELL', stepOffset: -3, ratio: 1 },
      { type: 'PUT', action: 'BUY', stepOffset: -6, ratio: 1 },
      { type: 'CALL', action: 'SELL', stepOffset: 3, ratio: 1 },
      { type: 'CALL', action: 'BUY', stepOffset: 6, ratio: 1 },
    ],
    when: 'Range-bound with elevated IV, and you want defined risk (unlike a short strangle). A staple income trade.',
    what: 'Sell an OTM put spread and an OTM call spread simultaneously.',
    why: 'Double credit from both wings; the long options define risk. Profits from time decay and IV contraction while price stays in the body.',
    maxProfit: 'Total net credit (price between the short strikes at expiry).',
    maxLoss: 'Wider wing width − credit (price beyond a long strike).',
    adjustments: [
      { scenario: 'Price drifts to one short strike', trigger: 'Tested short delta ~0.30', action: 'Roll the untested spread closer to spot for extra credit, recentring the condor.', rationale: 'Collect more premium and rebalance delta toward neutral.' },
      { scenario: 'Breakout through a short strike', trigger: 'Price into the tested spread', action: 'Roll the tested spread out in time (and possibly out in strike) for a credit.', rationale: 'Adds duration for mean reversion while staying defined-risk.' },
      { scenario: 'Profit target reached', trigger: '~50% of max profit', action: 'Close the entire condor.', rationale: 'The back half of the credit carries most of the risk.' },
      { scenario: 'IV collapses fast', trigger: 'Vol crush with price centred', action: 'Take profit early — short vega gains realised.', rationale: 'Little left to gain; avoid pin/gamma risk into expiry.' },
      { scenario: 'Both sides quiet, expiry near', trigger: 'Price in the body, days left', action: 'Consider closing the cheap side and holding the safer side, or just close all.', rationale: 'Reduce tail risk while banking most of the credit.' },
    ],
  },
  {
    id: 'iron-butterfly',
    name: 'Iron Butterfly',
    view: 'Neutral',
    risk: 'Defined risk / larger credit',
    legs: [
      { type: 'PUT', action: 'SELL', stepOffset: 0, ratio: 1 },
      { type: 'CALL', action: 'SELL', stepOffset: 0, ratio: 1 },
      { type: 'PUT', action: 'BUY', stepOffset: -4, ratio: 1 },
      { type: 'CALL', action: 'BUY', stepOffset: 4, ratio: 1 },
    ],
    when: 'You expect price to pin near a specific level (the ATM strike) with high IV. Larger credit, narrower profit zone than a condor.',
    what: 'Sell an ATM straddle and buy protective OTM wings.',
    why: 'Maximum decay at the body; the wings define risk. Profits if price finishes near the center.',
    maxProfit: 'Net credit (price at the center strike at expiry).',
    maxLoss: 'Wing width − credit (price beyond a wing).',
    adjustments: [
      { scenario: 'Price moves off center', trigger: 'Price approaches a wing', action: 'Recenter by rolling the whole fly toward the new price, or convert to a condor by widening the body.', rationale: 'Follow price and widen the profit zone.' },
      { scenario: 'Strong trend', trigger: 'Price past a short strike', action: 'Roll the tested side out for credit; consider legging the untested side down.', rationale: 'Buy time and reduce directional loss.' },
      { scenario: 'Quick profit', trigger: '25–40% of credit (fly profits come fast at the pin)', action: 'Close — the profit window is narrow.', rationale: 'Butterflies rarely reach full max; take money off the table.' },
      { scenario: 'IV crush at the pin', trigger: 'Vol drop with price centred', action: 'Hold to capture decay, or close if near target.', rationale: 'Short vega and theta both help at the center.' },
    ],
  },
  {
    id: 'cash-secured-put',
    name: 'Cash-Secured / Short Put',
    view: 'Bullish',
    risk: 'Undefined (to zero) / income',
    legs: [{ type: 'PUT', action: 'SELL', stepOffset: -3, ratio: 1 }],
    when: 'Willing to own the underlying lower, or simply bullish with high IV. A core income/entry strategy.',
    what: 'Sell an OTM put, secured by cash to buy the underlying if assigned.',
    why: 'Collect premium; if price stays up you keep it, if it falls you get assigned at a discount to today.',
    maxProfit: 'Premium received (price at/above strike at expiry).',
    maxLoss: 'Strike − premium (price to zero). Large but defined by the strike.',
    adjustments: [
      { scenario: 'Price holds up', trigger: '~50% of premium captured', action: 'Close and re-sell a new put (roll the income).', rationale: 'Compounds premium and resets the clock.' },
      { scenario: 'Price falls toward strike', trigger: 'Short put ITM risk rising', action: 'Roll down and out for a credit, or accept assignment if you want the underlying.', rationale: 'Lower the effective entry or take the shares at a discount.' },
      { scenario: 'Assigned the underlying', trigger: 'Price below strike at expiry', action: 'Begin selling covered calls against the position (start "the wheel").', rationale: 'Generate income on the assigned shares.' },
      { scenario: 'IV spikes', trigger: 'Vol expansion', action: 'Hold or sell more premium — richer rolls available.', rationale: 'High IV pays put sellers well.' },
    ],
  },
  {
    id: 'covered-call',
    name: 'Covered Call',
    view: 'Neutral',
    risk: 'Income on a long underlying',
    legs: [{ type: 'CALL', action: 'SELL', stepOffset: 3, ratio: 1 }],
    when: 'You hold the underlying and are neutral-to-mildly-bullish; you want yield and a small downside cushion.',
    what: 'Sell an OTM call against a long position in the underlying (add the underlying leg separately).',
    why: 'Premium adds yield and cushions small dips; caps upside at the short strike.',
    maxProfit: '(Short strike − cost basis) + premium (price at/above strike).',
    maxLoss: 'On the underlying, reduced by the premium (price falls).',
    adjustments: [
      { scenario: 'Underlying rallies toward the call', trigger: 'Short call near/at the money', action: 'Roll the call up and out for a credit to keep more upside.', rationale: 'Avoid capping the gain too early while staying paid.' },
      { scenario: 'Underlying falls', trigger: 'Price drops below cost basis', action: 'Roll the call down to collect more premium as a cushion.', rationale: 'Increase downside protection from decay.' },
      { scenario: 'Call about to expire OTM', trigger: 'Short call worthless near expiry', action: 'Let it expire and sell the next cycle.', rationale: 'Recurring income on the holding.' },
      { scenario: 'Assignment risk on a dividend', trigger: 'Deep ITM call before ex-dividend', action: 'Roll out or close to avoid early assignment.', rationale: 'Protects the dividend capture.' },
    ],
  },
  {
    id: 'calendar-spread',
    name: 'Calendar Spread',
    view: 'Neutral',
    risk: 'Defined risk / long vega',
    legs: [
      { type: 'CALL', action: 'SELL', stepOffset: 0, ratio: 1 },
      { type: 'CALL', action: 'BUY', stepOffset: 0, ratio: 1, dteOffset: 30 },
    ],
    when: 'Neutral near-term but expect movement or rising IV later; low current IV that you expect to rise.',
    what: 'Sell a near-dated ATM option and buy a longer-dated ATM option at the same strike.',
    why: 'The near leg decays faster than the far leg (positive theta) and the position is long vega, so it gains if IV rises.',
    maxProfit: 'Near the strike as the front leg expires (peaked, path-dependent).',
    maxLoss: 'Net debit paid (a large move away from the strike).',
    adjustments: [
      { scenario: 'Price pins the strike', trigger: 'Front leg near expiry, price at strike', action: 'Roll the short leg to the next cycle (a new calendar) for more credit.', rationale: 'Harvests recurring front-month decay.' },
      { scenario: 'Price drifts from the strike', trigger: 'Spot moving away from the center', action: 'Roll the calendar to a new strike near spot (a diagonal).', rationale: 'Recenters the peak of the payoff.' },
      { scenario: 'IV rises', trigger: 'Vol expansion', action: 'Consider taking profit — long vega gains realised.', rationale: 'Calendars are long vega; capture the pop.' },
      { scenario: 'IV collapses', trigger: 'Front-month vol crush', action: 'Close if the debit is impaired; the long leg loses vega value.', rationale: 'Avoid compounding a vol loss with a directional miss.' },
    ],
  },
];
