import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { STRATEGIES, type MarketView, type Strategy } from '../constants/strategies';
import { theme } from '../theme';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { fmtNum } from '../utils/format';
import { buildStrategyLegs } from '../utils/strategyBuilder';

interface Props {
  onApplied: () => void;
}

const VIEWS: (MarketView | 'All')[] = ['All', 'Bullish', 'Bearish', 'Neutral', 'Volatile'];

const viewColor = (v: MarketView): string =>
  v === 'Bullish' ? theme.colors.profit
  : v === 'Bearish' ? theme.colors.loss
  : v === 'Volatile' ? theme.colors.primary
  : theme.colors.textDim;

/**
 * Strategy playbook: browse predefined strategies with when/what/why notes and
 * a full adjustment guide (all scenarios), then apply one to the book.
 */
export function StrategyLibrary({ onApplied }: Props) {
  const asset = usePortfolioStore((s) => s.asset);
  const spot = usePortfolioStore((s) => s.spotPrice);
  const defaultIv = usePortfolioStore((s) => s.defaultIv);
  const rate = usePortfolioStore((s) => s.rate);
  const setOpenPositions = usePortfolioStore((s) => s.setOpenPositions);

  const [filter, setFilter] = useState<MarketView | 'All'>('All');
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = useMemo(
    () => (filter === 'All' ? STRATEGIES : STRATEGIES.filter((s) => s.view === filter)),
    [filter],
  );

  const apply = (strategy: Strategy) => {
    const legs = buildStrategyLegs(strategy, asset, spot, defaultIv, rate);
    setOpenPositions(legs);
    onApplied();
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 110 }}>
      <View style={styles.filterRow}>
        {VIEWS.map((v) => (
          <TouchableOpacity key={v} style={[styles.filterChip, filter === v && styles.filterActive]} onPress={() => setFilter(v)}>
            <Text style={[styles.filterTxt, filter === v && styles.filterTxtActive]}>{v}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.note}>
        Applying replaces your open legs with the strategy, priced on {asset.symbol} around{' '}
        {fmtNum(spot, 0)} at {fmtNum(defaultIv * 100, 0)}% IV. Tune afterwards on the Positions tab.
      </Text>

      {list.map((s) => (
        <StrategyCard
          key={s.id}
          strategy={s}
          expanded={expanded === s.id}
          onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
          onApply={() => apply(s)}
        />
      ))}
    </ScrollView>
  );
}

function StrategyCard({
  strategy,
  expanded,
  onToggle,
  onApply,
}: {
  strategy: Strategy;
  expanded: boolean;
  onToggle: () => void;
  onApply: () => void;
}) {
  const color = viewColor(strategy.view);
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.cardHead} onPress={onToggle} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={styles.name}>{strategy.name}</Text>
            <View style={[styles.badge, { borderColor: color }]}>
              <Text style={[styles.badgeTxt, { color }]}>{strategy.view}</Text>
            </View>
          </View>
          <Text style={styles.what}>{strategy.what}</Text>
          <Text style={styles.risk}>{strategy.risk}</Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.detail}>
          <Guide label="When" text={strategy.when} />
          <Guide label="Why it works" text={strategy.why} />

          <View style={styles.metaRow}>
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Max Profit</Text>
              <Text style={[styles.metaVal, { color: theme.colors.profit }]}>{strategy.maxProfit}</Text>
            </View>
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Max Loss</Text>
              <Text style={[styles.metaVal, { color: theme.colors.loss }]}>{strategy.maxLoss}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Legs</Text>
          {strategy.legs.map((leg, i) => (
            <Text key={i} style={styles.legLine}>
              <Text style={{ color: leg.action === 'BUY' ? theme.colors.buy : theme.colors.sell, fontWeight: '700' }}>
                {leg.action}
              </Text>{' '}
              {leg.ratio}× {leg.type}{' '}
              {leg.stepOffset === 0 ? 'ATM' : `ATM${leg.stepOffset > 0 ? '+' : ''}${leg.stepOffset} steps`}
              {leg.dteOffset ? `  (+${leg.dteOffset}d expiry)` : ''}
            </Text>
          ))}

          <Text style={styles.sectionTitle}>Adjustment guide — all scenarios</Text>
          {strategy.adjustments.map((a, i) => (
            <View key={i} style={styles.adj}>
              <Text style={styles.adjScenario}>{i + 1}. {a.scenario}</Text>
              <Text style={styles.adjLine}><Text style={styles.adjKey}>When: </Text>{a.trigger}</Text>
              <Text style={styles.adjLine}><Text style={styles.adjKey}>Do: </Text>{a.action}</Text>
              <Text style={styles.adjLine}><Text style={styles.adjKey}>Why: </Text>{a.rationale}</Text>
            </View>
          ))}

          <TouchableOpacity style={styles.applyBtn} onPress={onApply}>
            <Text style={styles.applyTxt}>Apply this strategy</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

function Guide({ label, text }: { label: string; text: string }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.guideLabel}>{label}</Text>
      <Text style={styles.guideText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.bg },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  filterChip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 16, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  filterActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  filterTxt: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
  filterTxtActive: { color: '#0B0E11' },
  note: { color: theme.colors.textFaint, fontSize: 12, marginHorizontal: 12, marginBottom: 8, lineHeight: 17 },
  card: { backgroundColor: theme.colors.surface, marginHorizontal: 12, marginBottom: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  badge: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  badgeTxt: { fontSize: 10, fontWeight: '700' },
  what: { color: theme.colors.textDim, fontSize: 12, marginTop: 5, lineHeight: 17 },
  risk: { color: theme.colors.textFaint, fontSize: 11, marginTop: 4 },
  chevron: { color: theme.colors.textDim, fontSize: 12, marginLeft: 10 },
  detail: { paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 },
  guideLabel: { color: theme.colors.primary, fontSize: 12, fontWeight: '700', marginBottom: 3 },
  guideText: { color: theme.colors.text, fontSize: 13, lineHeight: 19 },
  metaRow: { flexDirection: 'row', gap: 12, marginVertical: 6 },
  metaCell: { flex: 1, backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, padding: 10 },
  metaLabel: { color: theme.colors.textDim, fontSize: 11, marginBottom: 4 },
  metaVal: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  sectionTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '700', marginTop: 14, marginBottom: 8 },
  legLine: { color: theme.colors.textDim, fontSize: 13, marginBottom: 4 },
  adj: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, padding: 10, marginBottom: 8 },
  adjScenario: { color: theme.colors.text, fontSize: 13, fontWeight: '600', marginBottom: 5 },
  adjLine: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17, marginBottom: 2 },
  adjKey: { color: theme.colors.textFaint, fontWeight: '700' },
  applyBtn: { backgroundColor: theme.colors.primary, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 14 },
  applyTxt: { color: '#0B0E11', fontSize: 15, fontWeight: '700' },
});
