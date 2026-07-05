import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { bsPrice } from '../hooks/useBlackScholes';
import { theme } from '../theme';
import type { OptionPosition } from '../types';
import { daysBetween, fmtNum, todayIso } from '../utils/format';
import { closedOffset, legValuePnl } from '../utils/payoff';

interface Props {
  open: OptionPosition[];
  closed: OptionPosition[];
  spot: number; // live spot
  targetSpot: number;
  targetDate: string;
  ivShift: number;
  rate: number;
  currency: string;
}

function contractLabel(p: OptionPosition): string {
  const d = p.expiry.replace(/-/g, '').slice(2);
  if (p.instrumentType === 'FUTURE') return `${p.instrument} FUT-${d}`;
  const t = p.type === 'CALL' ? 'C' : 'P';
  return `${t}-${p.strike}-${d}`;
}

/** Module 3 — PNL Table: est price, entry, projected target PNL + totals. */
function PnlTableBase({ open, closed, spot, targetSpot, targetDate, ivShift, rate, currency }: Props) {
  const today = todayIso();

  const projectedTotal =
    open.reduce((a, p) => a + legValuePnl(p, targetSpot, targetDate, ivShift, rate), 0) +
    closedOffset(closed);

  const currentUpnl =
    open.reduce((a, p) => a + legValuePnl(p, spot, today, 0, rate), 0) + closedOffset(closed);

  return (
    <View style={styles.wrap}>
      <View style={[styles.row, styles.head]}>
        <Text style={[styles.cName, styles.h]}>Contract</Text>
        <Text style={[styles.c, styles.h]}>Est. Price</Text>
        <Text style={[styles.c, styles.h]}>Entry</Text>
        <Text style={[styles.c, styles.h]}>Target PNL</Text>
      </View>

      {open.map((p) => {
        const days = Math.max(daysBetween(targetDate, p.expiry), 0);
        const est = bsPrice({
          spot: targetSpot,
          strike: p.strike,
          timeYears: days / 365,
          rate,
          iv: Math.max(p.iv + ivShift, 0.0001),
          type: p.type,
        });
        const pnl = legValuePnl(p, targetSpot, targetDate, ivShift, rate);
        return (
          <View style={styles.row} key={p.id}>
            <View style={styles.cName}>
              <Text style={styles.name}>{contractLabel(p)}</Text>
              <Text style={styles.size}>{fmtNum(p.lots * p.lotSize, 3)} {p.instrument}</Text>
            </View>
            <Text style={styles.c}>{fmtNum(est, 1)}</Text>
            <Text style={styles.c}>{fmtNum(p.entryPremium, 1)}</Text>
            <Text style={[styles.c, { color: pnl >= 0 ? theme.colors.profit : theme.colors.loss }]}>
              {fmtNum(pnl, 2)}
            </Text>
          </View>
        );
      })}

      {closed.map((p) => (
        <View style={[styles.row, styles.closedRow]} key={p.id}>
          <View style={styles.cName}>
            <Text style={[styles.name, styles.closedName]}>{contractLabel(p)} (closed)</Text>
            <Text style={styles.size}>{fmtNum(p.lots * p.lotSize, 3)} {p.instrument}</Text>
          </View>
          <Text style={styles.c}>{fmtNum(p.exitPremium ?? 0, 1)}</Text>
          <Text style={styles.c}>{fmtNum(p.entryPremium, 1)}</Text>
          <Text style={[styles.c, { color: (p.realizedPnl ?? 0) >= 0 ? theme.colors.profit : theme.colors.loss }]}>
            {fmtNum(p.realizedPnl ?? 0, 2)}
          </Text>
        </View>
      ))}

      <View style={styles.summaryRow}>
        <Text style={styles.sumLabel}>Total Projected PNL</Text>
        <Text style={[styles.sumVal, { color: projectedTotal >= 0 ? theme.colors.profit : theme.colors.loss }]}>
          {fmtNum(projectedTotal, 2)} {currency}
        </Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={styles.sumLabel}>Total Current UPNL</Text>
        <Text style={[styles.sumVal, { color: currentUpnl >= 0 ? theme.colors.profit : theme.colors.loss }]}>
          {fmtNum(currentUpnl, 2)} {currency}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: theme.colors.bg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: 1,
  },
  head: { backgroundColor: theme.colors.surface, paddingVertical: 10 },
  closedRow: { opacity: 0.7 },
  cName: { flex: 2.2 },
  c: { flex: 1, color: theme.colors.text, fontSize: 12, textAlign: 'center' },
  h: { color: theme.colors.textDim, fontSize: 11 },
  name: { color: theme.colors.text, fontSize: 12, fontWeight: '500' },
  closedName: { color: theme.colors.textDim },
  size: { color: theme.colors.textFaint, fontSize: 10, marginTop: 2 },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: 1,
  },
  sumLabel: { color: theme.colors.textDim, fontSize: 13 },
  sumVal: { fontSize: 13, fontWeight: '600' },
});

export const PnlTable = React.memo(PnlTableBase);
