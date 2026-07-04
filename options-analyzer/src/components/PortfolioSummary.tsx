import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';
import type { OptionPosition } from '../types';
import { fmtNum, todayIso } from '../utils/format';
import { portfolioPnl, portfolioValuePnl, type CurveParams } from '../utils/payoff';

interface Props {
  open: OptionPosition[];
  closed: OptionPosition[];
  spot: number;
  rate: number;
  params: CurveParams;
  targetSpot: number;
  currency: string;
}

/**
 * Portfolio PNL tracker. Splits banked (realized, from closed legs) from
 * floating (unrealized, open legs marked now) so tracking stays correct after
 * legs are closed, plus the projected total at the simulated target.
 */
function PortfolioSummaryBase({ open, closed, spot, rate, params, targetSpot, currency }: Props) {
  const pnl = useMemo(
    () => portfolioPnl(open, closed, spot, todayIso(), rate),
    [open, closed, spot, rate],
  );
  const projected = useMemo(() => portfolioValuePnl(targetSpot, params), [params, targetSpot]);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Cell label={`Realized (${closed.length} closed)`} value={pnl.realized} currency={currency} />
        <Cell label="Unrealized (open)" value={pnl.unrealized} currency={currency} />
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Cell label="Total PNL (now)" value={pnl.total} currency={currency} bold />
        <Cell label="Projected @ target" value={projected} currency={currency} bold />
      </View>
    </View>
  );
}

function Cell({
  label,
  value,
  currency,
  bold,
}: {
  label: string;
  value: number;
  currency: string;
  bold?: boolean;
}) {
  const color = value >= 0 ? theme.colors.profit : theme.colors.loss;
  return (
    <View style={styles.cell}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, bold && styles.valueBold, { color }]}>
        {value >= 0 ? '+' : ''}
        {fmtNum(value, 2)} {currency}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
  },
  row: { flexDirection: 'row' },
  cell: { flex: 1, paddingHorizontal: 4 },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 10 },
  label: { color: theme.colors.textDim, fontSize: 11, marginBottom: 5 },
  value: { fontSize: 14, fontWeight: '600' },
  valueBold: { fontSize: 16, fontWeight: '700' },
});

export const PortfolioSummary = React.memo(PortfolioSummaryBase);
