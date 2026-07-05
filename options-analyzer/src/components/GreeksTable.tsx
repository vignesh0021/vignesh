import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';
import type { Greeks, OptionPosition } from '../types';
import { fmtNum } from '../utils/format';
import { legGreeks } from '../utils/payoff';

interface Props {
  open: OptionPosition[];
  closed: OptionPosition[];
  spot: number;
  evalDate: string;
  ivShift: number;
  rate: number;
  net: Greeks;
}

function contractLabel(p: OptionPosition): string {
  const d = p.expiry.replace(/-/g, '').slice(2); // yymmdd
  if (p.instrumentType === 'FUTURE') return `${p.instrument} FUT-${d}`;
  const t = p.type === 'CALL' ? 'C' : 'P';
  return `${t}-${p.strike}-${d}`;
}

/** Module 3 — Portfolio Risk Matrix: per-contract Greeks + net aggregate. */
function GreeksTableBase({ open, closed, spot, evalDate, ivShift, rate, net }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.row, styles.head]}>
        <Text style={[styles.cName, styles.h]}>Contract</Text>
        <Text style={[styles.c, styles.h]}>Delta</Text>
        <Text style={[styles.c, styles.h]}>Gamma</Text>
        <Text style={[styles.c, styles.h]}>Theta</Text>
        <Text style={[styles.c, styles.h]}>Vega</Text>
      </View>

      {open.map((p) => {
        const g = legGreeks(p, spot, evalDate, ivShift, rate);
        return (
          <View style={styles.row} key={p.id}>
            <View style={styles.cName}>
              <SBadge action={p.action} />
              <Text style={styles.name}>{contractLabel(p)}</Text>
            </View>
            <Text style={styles.c}>{fmtNum(g.delta, 2)}</Text>
            <Text style={styles.c}>{fmtNum(g.gamma, 5)}</Text>
            <Text style={styles.c}>{fmtNum(g.theta, 2)}</Text>
            <Text style={styles.c}>{fmtNum(g.vega, 2)}</Text>
          </View>
        );
      })}

      {closed.map((p) => (
        <View style={[styles.row, styles.closedRow]} key={p.id}>
          <View style={styles.cName}>
            <SBadge action={p.action} closed />
            <Text style={[styles.name, styles.closedName]}>{contractLabel(p)} (closed)</Text>
          </View>
          {/* Closed legs contribute exactly 0 to every Greek. */}
          <Text style={styles.c}>0</Text>
          <Text style={styles.c}>0</Text>
          <Text style={styles.c}>0</Text>
          <Text style={styles.c}>0</Text>
        </View>
      ))}

      <View style={[styles.row, styles.total]}>
        <Text style={[styles.cName, styles.totalTxt]}>Total</Text>
        <Text style={[styles.c, styles.totalTxt]}>{fmtNum(net.delta, 2)}</Text>
        <Text style={[styles.c, styles.totalTxt]}>{fmtNum(net.gamma, 5)}</Text>
        <Text style={[styles.c, styles.totalTxt]}>{fmtNum(net.theta, 2)}</Text>
        <Text style={[styles.c, styles.totalTxt]}>{fmtNum(net.vega, 2)}</Text>
      </View>
    </View>
  );
}

function SBadge({ action, closed }: { action: 'BUY' | 'SELL'; closed?: boolean }) {
  const isSell = action === 'SELL';
  const color = closed ? theme.colors.textFaint : isSell ? theme.colors.sell : theme.colors.buy;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeTxt, { color }]}>{isSell ? 'S' : 'B'}</Text>
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
  closedRow: { opacity: 0.6 },
  total: { backgroundColor: theme.colors.surface, borderBottomWidth: 0 },
  cName: { flex: 2.1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  c: { flex: 1, color: theme.colors.text, fontSize: 12, textAlign: 'center' },
  h: { color: theme.colors.textDim, fontSize: 11, fontWeight: '400' },
  name: { color: theme.colors.text, fontSize: 12 },
  closedName: { color: theme.colors.textDim },
  totalTxt: { color: theme.colors.text, fontWeight: '700', fontSize: 12, textAlign: 'left' },
  badge: { width: 18, height: 18, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badgeTxt: { fontSize: 10, fontWeight: '700' },
});

export const GreeksTable = React.memo(GreeksTableBase);
