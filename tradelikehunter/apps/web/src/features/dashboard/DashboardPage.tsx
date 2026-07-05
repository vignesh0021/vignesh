import {
  aggregateGreeks,
  computeRisk,
  legValuePnl,
  portfolioMargin,
  probabilityOfProfit,
} from '@tlh/domain';
import { Badge, Money, PnlText, StatTile, fmtNum } from '@tlh/ui';
import { useMemo } from 'react';

import { DEMO_IV, DEMO_RATE, DEMO_SPOT, STARTING_CAPITAL, demoBook, legLabel } from './demoBook';
import { PayoffMini } from './PayoffMini';

/**
 * Dashboard — every number here is computed live from @tlh/domain against the
 * demo book (real Black-Scholes valuation, Greeks, POP, margin). Live
 * paper-trading positions replace the demo book in Milestone 1.
 */
export function DashboardPage() {
  const m = useMemo(() => {
    // Nudge spot +0.35% to show a non-flat open P&L on the sample book.
    const nowSpot = DEMO_SPOT * 1.0035;
    const openPnl = demoBook.reduce((a, leg) => a + legValuePnl(leg, nowSpot, DEMO_RATE), 0);
    const greeks = aggregateGreeks(demoBook, nowSpot, DEMO_RATE);
    const risk = computeRisk(demoBook, DEMO_SPOT);
    const pop = probabilityOfProfit(demoBook, DEMO_SPOT, 20 / 365, DEMO_RATE, DEMO_IV);
    const margin = portfolioMargin(demoBook, DEMO_SPOT);
    return { nowSpot, openPnl, greeks, risk, pop, margin };
  }, []);

  const portfolioValue = STARTING_CAPITAL + m.openPnl;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted">Sample NIFTY iron condor · live-computed from the options engine</p>
        </div>
        <Badge tone={m.pop >= 0.5 ? 'good' : 'warn'}>POP {fmtNum(m.pop * 100, 0)}%</Badge>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Open P&L" value={<PnlText value={m.openPnl} />} />
        <StatTile label="Portfolio Value" value={<Money value={portfolioValue} digits={0} />} />
        <StatTile label="Margin Used" value={<Money value={m.margin} digits={0} />} />
        <StatTile label="Buying Power" value={<Money value={STARTING_CAPITAL - m.margin} digits={0} />} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Payoff */}
        <div className="rounded-lg border border-border bg-surface p-4 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Payoff at expiry</h2>
            <div className="font-mono text-xs text-muted">
              Max <span className="text-profit">{fmtNum(m.risk.maxProfit, 0)}</span> ·{' '}
              Loss <span className="text-loss">{m.risk.maxLossUnbounded ? '∞' : fmtNum(m.risk.maxLoss, 0)}</span> ·{' '}
              BE {m.risk.breakevens.map((b) => fmtNum(b, 0)).join(' / ')}
            </div>
          </div>
          <PayoffMini legs={demoBook} spot={DEMO_SPOT} />
        </div>

        {/* Greeks */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Portfolio Greeks</h2>
          <div className="grid grid-cols-2 gap-3">
            <Greek k="Delta" v={fmtNum(m.greeks.delta, 2)} />
            <Greek k="Gamma" v={fmtNum(m.greeks.gamma, 4)} />
            <Greek k="Theta / day" v={fmtNum(m.greeks.theta, 0)} tone={m.greeks.theta >= 0 ? 'good' : 'bad'} />
            <Greek k="Vega / 1%" v={fmtNum(m.greeks.vega, 0)} />
          </div>
          <p className="mt-3 text-xs text-faint">
            Positive theta means the book earns from time decay each day.
          </p>
        </div>
      </div>

      {/* Positions */}
      <div className="mt-3 rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">Positions ({demoBook.length})</div>
        <div className="divide-y divide-border">
          {demoBook.map((leg, i) => {
            const pnl = legValuePnl(leg, m.nowSpot, DEMO_RATE);
            const short = leg.action === 'SELL';
            return (
              <div key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className={`h-4 w-1 rounded ${short ? 'bg-loss' : 'bg-profit'}`} />
                <span className="font-mono font-semibold">{legLabel(leg)}</span>
                <span className="font-mono text-xs text-muted">
                  {short ? '-' : '+'}{leg.size} · entry {fmtNum(leg.entryPrice, 1)}
                </span>
                <span className="ml-auto"><PnlText value={pnl} /></span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Greek({ k, v, tone }: { k: string; v: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-profit' : tone === 'bad' ? 'text-loss' : 'text-text';
  return (
    <div className="rounded-md bg-surface-2 p-3">
      <div className="text-[10px] uppercase tracking-wide text-faint">{k}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${color}`}>{v}</div>
    </div>
  );
}
