import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { STRATEGIES, type MarketView, type Strategy } from '../constants/strategies';
import { theme } from '../theme';

/**
 * One-tap strategy deployer for paper trading. Picks the exact live strikes
 * around ATM and places every leg as a paper order at the live chain LTP — no
 * manual leg-by-leg entry.
 */
const viewColor = (v: MarketView): string =>
  v === 'Bullish' ? theme.colors.profit
  : v === 'Bearish' ? theme.colors.loss
  : v === 'Volatile' ? theme.colors.primary
  : theme.colors.textDim;

export function PaperStrategyDeploy({
  live,
  onDeploy,
}: {
  live: boolean;
  onDeploy: (strategy: Strategy, lots: number) => void;
}) {
  const [lots, setLots] = useState(1);

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      <View style={styles.lotBar}>
        <Text style={styles.lotLabel}>Base lots</Text>
        <View style={styles.stepper}>
          <TouchableOpacity style={styles.stepBtn} onPress={() => setLots((n) => Math.max(1, n - 1))}>
            <Text style={styles.stepTxt}>–</Text>
          </TouchableOpacity>
          <Text style={styles.lotVal}>{lots}</Text>
          <TouchableOpacity style={styles.stepBtn} onPress={() => setLots((n) => n + 1)}>
            <Text style={styles.stepTxt}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.hint}>
        Deploys every leg at the {live ? 'live Fyers' : 'simulated'} price around the current ATM strike,
        as market paper orders. Manage them on the Positions tab.
      </Text>

      {STRATEGIES.map((s) => (
        <View key={s.id} style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.name}>{s.name}</Text>
            <View style={[styles.badge, { borderColor: viewColor(s.view) }]}>
              <Text style={[styles.badgeTxt, { color: viewColor(s.view) }]}>{s.view}</Text>
            </View>
          </View>
          <Text style={styles.legs}>
            {s.legs
              .map(
                (l) =>
                  `${l.action === 'BUY' ? '+' : '−'}${l.ratio} ${l.type} ${l.stepOffset === 0 ? 'ATM' : `ATM${l.stepOffset > 0 ? '+' : ''}${l.stepOffset}`}`,
              )
              .join('   ')}
          </Text>
          <TouchableOpacity style={styles.deployBtn} onPress={() => onDeploy(s, lots)} activeOpacity={0.85}>
            <Text style={styles.deployTxt}>⚡ Deploy {lots > 1 ? `×${lots} ` : ''}live</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  lotBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  lotLabel: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border },
  stepBtn: { paddingHorizontal: 16, paddingVertical: 6 },
  stepTxt: { color: theme.colors.text, fontSize: 20, fontWeight: '700' },
  lotVal: { color: theme.colors.text, fontSize: 15, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  hint: { color: theme.colors.textFaint, fontSize: 11, lineHeight: 16, marginBottom: 12 },
  card: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 12, marginBottom: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: theme.colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
  badge: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  badgeTxt: { fontSize: 10, fontWeight: '700' },
  legs: { color: theme.colors.textDim, fontSize: 12, marginTop: 8, lineHeight: 18 },
  deployBtn: { backgroundColor: theme.colors.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 12 },
  deployTxt: { color: '#0B0E11', fontSize: 14, fontWeight: '800' },
});
