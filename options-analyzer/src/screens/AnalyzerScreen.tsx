import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GreeksTable } from '../components/GreeksTable';
import { InstrumentPicker } from '../components/InstrumentPicker';
import { PayoffChart } from '../components/PayoffChart';
import { PnlTable } from '../components/PnlTable';
import { PortfolioSummary } from '../components/PortfolioSummary';
import { PositionList } from '../components/PositionList';
import { PositionSheet } from '../components/PositionSheet';
import { RiskMatrix } from '../components/RiskMatrix';
import { SimulationPanel } from '../components/SimulationPanel';
import { TestingEngine } from '../components/TestingEngine';
import { INSTRUMENTS } from '../constants/instruments';
import { theme } from '../theme';
import type { OptionPosition } from '../types';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { fmtNum } from '../utils/format';
import {
  aggregateGreeks,
  computeRisk,
  portfolioValuePnl,
  type CurveParams,
} from '../utils/payoff';

type Tab = 'PAYOFF' | 'PNL' | 'GREEKS' | 'POSITIONS' | 'BACKTEST';

const TABS: { key: Tab; label: string }[] = [
  { key: 'PAYOFF', label: 'PNL Chart' },
  { key: 'PNL', label: 'PNL Table' },
  { key: 'GREEKS', label: 'Greeks' },
  { key: 'POSITIONS', label: 'Positions' },
  { key: 'BACKTEST', label: 'Backtest' },
];

export function AnalyzerScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('PAYOFF');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<OptionPosition | null>(null);

  const open = usePortfolioStore((s) => s.openPositions);
  const closed = usePortfolioStore((s) => s.closedPositions);
  const instrumentKey = usePortfolioStore((s) => s.instrumentKey);
  const instrument = usePortfolioStore((s) => s.instrument);
  const spotPrice = usePortfolioStore((s) => s.spotPrice);
  const targetSpot = usePortfolioStore((s) => s.targetSpot);
  const targetDate = usePortfolioStore((s) => s.targetDate);
  const ivShift = usePortfolioStore((s) => s.ivShift);
  const rate = usePortfolioStore((s) => s.rate);
  const vix = usePortfolioStore((s) => s.vix);
  const vixSource = usePortfolioStore((s) => s.vixSource);
  const marketLoading = usePortfolioStore((s) => s.marketLoading);
  const refreshMarket = usePortfolioStore((s) => s.refreshMarket);

  const currency = INSTRUMENTS[instrumentKey].currency;

  // Pull a live quote once on mount; failures fall back silently to the seed.
  useEffect(() => {
    refreshMarket().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const params: CurveParams = useMemo(
    () => ({ open, closed, rate, ivShift, evalDateIso: targetDate }),
    [open, closed, rate, ivShift, targetDate],
  );

  const risk = useMemo(() => computeRisk(params, spotPrice), [params, spotPrice]);
  const netGreeks = useMemo(
    () => aggregateGreeks(open, targetSpot, targetDate, ivShift, rate),
    [open, targetSpot, targetDate, ivShift, rate],
  );
  const strikes = useMemo(() => open.map((p) => p.strike), [open]);
  const chartW = Dimensions.get('window').width;

  const openAdd = () => {
    setEditing(null);
    setSheetOpen(true);
  };
  const openEdit = (p: OptionPosition) => {
    setEditing(p);
    setSheetOpen(true);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header — tap the right block to switch script / edit market data */}
      <View style={styles.header}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.appTitle}>Options Payoff Analyzer</Text>
          <Text style={styles.subtitle}>Greeks · Payoff · Backtest</Text>
        </View>
        <TouchableOpacity style={styles.spotBox} onPress={() => setPickerOpen(true)} activeOpacity={0.7}>
          <Text style={styles.instrument}>{instrument} ▾</Text>
          <Text style={styles.spot}>{fmtNum(spotPrice, 1)}</Text>
          <Text style={styles.vix}>
            {marketLoading ? 'fetching…' : `${INSTRUMENTS[instrumentKey].vixLabel} ${vix != null ? fmtNum(vix, 1) + '%' : '—'}`}
            {vixSource ? ' ↻' : ' ↻'}
          </Text>
        </TouchableOpacity>
      </View>

      <RiskMatrix risk={risk} currency={currency} />

      {/* Tabs */}
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabTxt, tab === t.key && styles.tabTxtActive]}>{t.label}</Text>
            {tab === t.key ? <View style={styles.tabUnderline} /> : null}
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'BACKTEST' ? (
        <TestingEngine />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
          {tab === 'PAYOFF' && (
            <>
              <View style={styles.chartWrap}>
                <PayoffChart
                  width={chartW}
                  height={300}
                  params={params}
                  spot={spotPrice}
                  targetSpot={targetSpot}
                  strikes={strikes}
                  breakevens={risk.breakevens}
                />
              </View>
              <ProjectedBanner params={params} targetSpot={targetSpot} spot={spotPrice} currency={currency} />
              <PortfolioSummary open={open} closed={closed} spot={spotPrice} rate={rate} params={params} targetSpot={targetSpot} currency={currency} />
              <SimulationPanel />
            </>
          )}

          {tab === 'PNL' && (
            <>
              <PnlTable open={open} closed={closed} spot={spotPrice} targetSpot={targetSpot} targetDate={targetDate} ivShift={ivShift} rate={rate} currency={currency} />
              <SimulationPanel />
            </>
          )}

          {tab === 'GREEKS' && (
            <>
              <GreeksTable open={open} closed={closed} spot={targetSpot} evalDate={targetDate} ivShift={ivShift} rate={rate} net={netGreeks} />
              <SimulationPanel />
            </>
          )}

          {tab === 'POSITIONS' && (
            <>
              <PortfolioSummary open={open} closed={closed} spot={spotPrice} rate={rate} params={params} targetSpot={targetSpot} currency={currency} />
              <PositionList onEdit={openEdit} />
            </>
          )}
        </ScrollView>
      )}

      {/* Add button */}
      {tab !== 'BACKTEST' ? (
        <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 16 }]} onPress={openAdd} activeOpacity={0.85}>
          <Text style={styles.fabTxt}>＋ Add Contract</Text>
        </TouchableOpacity>
      ) : null}

      <PositionSheet visible={sheetOpen} editing={editing} onClose={() => setSheetOpen(false)} />
      <InstrumentPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} />
    </View>
  );
}

function ProjectedBanner({
  params,
  targetSpot,
  spot,
  currency,
}: {
  params: CurveParams;
  targetSpot: number;
  spot: number;
  currency: string;
}) {
  const projected = useMemo(() => portfolioValuePnl(targetSpot, params), [params, targetSpot]);
  const pctMove = spot > 0 ? ((targetSpot - spot) / spot) * 100 : 0;
  const color = projected >= 0 ? theme.colors.profit : theme.colors.loss;
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerTxt}>
        Target {fmtNum(targetSpot, 0)} ({pctMove >= 0 ? '+' : ''}{fmtNum(pctMove, 1)}%) · Projected{' '}
        <Text style={{ color, fontWeight: '700' }}>{fmtNum(projected, 2)} {currency}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  appTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  spotBox: { alignItems: 'flex-end' },
  instrument: { color: theme.colors.primary, fontSize: 13, fontWeight: '700' },
  spot: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  vix: { color: theme.colors.textDim, fontSize: 11, marginTop: 1 },
  tabBar: { flexDirection: 'row', backgroundColor: theme.colors.bg, borderBottomColor: theme.colors.border, borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabTxt: { color: theme.colors.textDim, fontSize: 12.5, fontWeight: '600' },
  tabTxtActive: { color: theme.colors.text },
  tabUnderline: { height: 2, backgroundColor: theme.colors.primary, width: '70%', marginTop: 8, borderRadius: 2 },
  chartWrap: { paddingTop: 8 },
  banner: { alignSelf: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4, marginBottom: 4 },
  bannerTxt: { color: theme.colors.textDim, fontSize: 12 },
  fab: { position: 'absolute', alignSelf: 'center', backgroundColor: theme.colors.primary, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 28 },
  fabTxt: { color: '#0B0E11', fontWeight: '700', fontSize: 15 },
});
