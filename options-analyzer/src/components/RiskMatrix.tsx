import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';
import { fmtNum } from '../utils/format';
import type { RiskSummary } from '../utils/payoff';

interface Props {
  risk: RiskSummary;
}

/** The header strip: Max Profit / Max Loss / Reward-Risk / Break-even. */
function RiskMatrixBase({ risk }: Props) {
  const be = risk.breakevens;
  const beText =
    be.length === 0
      ? '—'
      : be
          .slice(0, 2)
          .map((b) => fmtNum(b, 2))
          .join(',\n');

  return (
    <View style={styles.row}>
      <Cell label="Max Profit" value={risk.maxProfitUnbounded ? 'Unlimited' : `${fmtNum(risk.maxProfit)} USD`} color={risk.maxProfitUnbounded ? theme.colors.profit : theme.colors.profit} />
      <Cell label="Max Loss" value={risk.maxLossUnbounded ? 'Unlimited' : `${fmtNum(risk.maxLoss)} USD`} color={theme.colors.loss} />
      <Cell label="Reward / Risk" value={risk.rewardRisk == null ? 'NA' : fmtNum(risk.rewardRisk, 2)} color={theme.colors.text} />
      <Cell label="Breakeven" value={beText} color={theme.colors.text} align="right" />
    </View>
  );
}

function Cell({
  label,
  value,
  color,
  align = 'left',
}: {
  label: string;
  value: string;
  color: string;
  align?: 'left' | 'right';
}) {
  return (
    <View style={[styles.cell, { alignItems: align === 'right' ? 'flex-end' : 'flex-start' }]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color, textAlign: align }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: 1,
  },
  cell: { flex: 1, paddingHorizontal: 4 },
  label: { color: theme.colors.textDim, fontSize: 11, marginBottom: 6 },
  value: { fontSize: 13, fontWeight: '600' },
});

export const RiskMatrix = React.memo(RiskMatrixBase);
