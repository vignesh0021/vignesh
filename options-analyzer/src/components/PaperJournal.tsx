import React, { useMemo } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';

import { theme } from '../theme';
import { fmtNum } from '../utils/format';
import { usePaperStore, positionPnl } from '../store/usePaperStore';

/**
 * Trade journal & performance analytics — the learning loop of paper trading.
 * Everything derives from the persisted trade log: win rate, profit factor,
 * average win/loss, best/worst trades, an equity curve of realized P&L, and a
 * day-wise breakdown so the user can see WHICH sessions made or lost money.
 */
export function PaperJournal({ currency }: { currency: string }) {
  const trades = usePaperStore((s) => s.trades);
  const positions = usePaperStore((s) => s.positions);
  const realizedPnl = usePaperStore((s) => s.realizedPnl);
  const startingFunds = usePaperStore((s) => s.startingFunds);

  const exits = useMemo(
    () => trades.filter((t) => t.kind === 'EXIT' && t.realized != null).sort((a, b) => a.at - b.at),
    [trades],
  );

  const stats = useMemo(() => {
    const wins = exits.filter((t) => (t.realized ?? 0) > 0);
    const losses = exits.filter((t) => (t.realized ?? 0) < 0);
    const grossWin = wins.reduce((a, t) => a + (t.realized ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + (t.realized ?? 0), 0));
    const best = exits.reduce((m, t) => Math.max(m, t.realized ?? 0), 0);
    const worst = exits.reduce((m, t) => Math.min(m, t.realized ?? 0), 0);
    return {
      count: exits.length,
      winRate: exits.length ? (wins.length / exits.length) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
      avgWin: wins.length ? grossWin / wins.length : 0,
      avgLoss: losses.length ? grossLoss / losses.length : 0,
      best,
      worst,
    };
  }, [exits]);

  // Equity curve: cumulative realized P&L per closing trade.
  const curve = useMemo(() => {
    let acc = 0;
    return [0, ...exits.map((t) => (acc += t.realized ?? 0))];
  }, [exits]);

  // Day-wise P&L (newest first).
  const days = useMemo(() => {
    const map = new Map<string, { pnl: number; trades: number }>();
    for (const t of exits) {
      const day = new Date(t.at).toISOString().slice(0, 10);
      const cur = map.get(day) ?? { pnl: 0, trades: 0 };
      cur.pnl += t.realized ?? 0;
      cur.trades += 1;
      map.set(day, cur);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [exits]);

  const openMtm = positions.reduce((a, p) => a + positionPnl(p), 0);
  const returnPct = startingFunds > 0 ? (realizedPnl / startingFunds) * 100 : 0;

  if (exits.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.emptyWrap}>
        <Text style={styles.emptyBig}>No closed trades yet</Text>
        <Text style={styles.emptySmall}>
          Your performance journal builds itself as you square off paper trades — win rate, profit
          factor, equity curve and day-wise P&L will appear here.
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      {/* Headline */}
      <View style={styles.headline}>
        <View>
          <Text style={styles.hLabel}>Net realized P&L</Text>
          <Text style={[styles.hVal, { color: realizedPnl >= 0 ? theme.colors.profit : theme.colors.loss }]}>
            {realizedPnl >= 0 ? '+' : ''}
            {fmtNum(realizedPnl, 0)} {currency}
          </Text>
          <Text style={styles.hSub}>
            {returnPct >= 0 ? '+' : ''}
            {fmtNum(returnPct, 2)}% on capital · open MTM {openMtm >= 0 ? '+' : ''}
            {fmtNum(openMtm, 0)}
          </Text>
        </View>
      </View>

      {/* Equity curve */}
      <Text style={styles.section}>Equity curve (realized)</Text>
      <EquityCurve points={curve} />

      {/* Stats grid */}
      <Text style={styles.section}>Statistics · {stats.count} closed trades</Text>
      <View style={styles.grid}>
        <Stat label="Win rate" value={`${fmtNum(stats.winRate, 0)}%`} />
        <Stat
          label="Profit factor"
          value={stats.profitFactor === Infinity ? '∞' : fmtNum(stats.profitFactor, 2)}
          color={stats.profitFactor >= 1 ? theme.colors.profit : theme.colors.loss}
        />
        <Stat label="Avg win" value={`+${fmtNum(stats.avgWin, 0)}`} color={theme.colors.profit} />
        <Stat label="Avg loss" value={`−${fmtNum(stats.avgLoss, 0)}`} color={theme.colors.loss} />
        <Stat label="Best trade" value={`+${fmtNum(stats.best, 0)}`} color={theme.colors.profit} />
        <Stat label="Worst trade" value={fmtNum(stats.worst, 0)} color={theme.colors.loss} />
      </View>

      {/* Day-wise */}
      <Text style={styles.section}>Day-wise P&L</Text>
      {days.map(([day, d]) => (
        <View key={day} style={styles.dayRow}>
          <Text style={styles.dayDate}>{day}</Text>
          <Text style={styles.dayTrades}>{d.trades} trade{d.trades === 1 ? '' : 's'}</Text>
          <Text style={[styles.dayPnl, { color: d.pnl >= 0 ? theme.colors.profit : theme.colors.loss }]}>
            {d.pnl >= 0 ? '+' : ''}
            {fmtNum(d.pnl, 0)}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

function EquityCurve({ points }: { points: number[] }) {
  const width = Dimensions.get('window').width - 24;
  const height = 140;
  const pad = 8;
  const lo = Math.min(...points, 0);
  const hi = Math.max(...points, 0);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i / Math.max(points.length - 1, 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const path = points.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const up = points[points.length - 1] >= 0;

  return (
    <View style={styles.chartCard}>
      <Svg width={width} height={height}>
        <Line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} stroke={theme.colors.grid} strokeWidth={1} strokeDasharray="4 4" />
        <Polyline
          points={path}
          fill="none"
          stroke={up ? theme.colors.profit : theme.colors.loss}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statVal, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyBig: { color: theme.colors.text, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  emptySmall: { color: theme.colors.textDim, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  headline: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14 },
  hLabel: { color: theme.colors.textDim, fontSize: 12 },
  hVal: { fontSize: 24, fontWeight: '800', marginTop: 4 },
  hSub: { color: theme.colors.textDim, fontSize: 12, marginTop: 4 },
  section: { color: theme.colors.text, fontSize: 13, fontWeight: '800', marginTop: 16, marginBottom: 8 },
  chartCard: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexBasis: '31%', flexGrow: 1, backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: 10, paddingHorizontal: 10 },
  statLabel: { color: theme.colors.textDim, fontSize: 10, marginBottom: 4 },
  statVal: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
  dayRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6 },
  dayDate: { color: theme.colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
  dayTrades: { color: theme.colors.textDim, fontSize: 12, marginRight: 12 },
  dayPnl: { fontSize: 14, fontWeight: '800' },
});
