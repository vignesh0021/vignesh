import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrokersScreen } from '../components/BrokersScreen';
import { GreeksTable } from '../components/GreeksTable';
import { InstrumentPicker } from '../components/InstrumentPicker';
import { PaperTradingScreen } from '../components/PaperTradingScreen';
import { PayoffChart } from '../components/PayoffChart';
import { PnlTable } from '../components/PnlTable';
import { PortfolioSummary } from '../components/PortfolioSummary';
import { PositionList } from '../components/PositionList';
import { PositionSheet } from '../components/PositionSheet';
import { RiskMatrix } from '../components/RiskMatrix';
import { SimulationPanel } from '../components/SimulationPanel';
import { BottomTabBar } from '../components/BottomTabBar';
import { StrategyLibrary } from '../components/StrategyLibrary';
import { TestingEngine } from '../components/TestingEngine';
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const logo = require('../../assets/icon.png');

type Tab = 'PAPER' | 'PAYOFF' | 'PNL' | 'GREEKS' | 'POSITIONS' | 'STRATEGY' | 'BACKTEST' | 'BROKERS';

// Kite/Dhan-style bottom nav: 4 primary slots + a "More" sheet for the rest.
const PRIMARY_TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'PAPER', label: 'Paper', icon: '📝' },
  { key: 'PAYOFF', label: 'Payoff', icon: '📉' },
  { key: 'POSITIONS', label: 'Positions', icon: '📂' },
  { key: 'STRATEGY', label: 'Strategy', icon: '🎯' },
];
const MORE_TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'BROKERS', label: 'Brokers', icon: '🔗' },
  { key: 'GREEKS', label: 'Greeks', icon: 'Δ' },
  { key: 'PNL', label: 'PNL Table', icon: '🧮' },
  { key: 'BACKTEST', label: 'Backtest', icon: '⏮️' },
];

export function AnalyzerScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('PAPER');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<OptionPosition | null>(null);

  const open = usePortfolioStore((s) => s.openPositions);
  const closed = usePortfolioStore((s) => s.closedPositions);
  const asset = usePortfolioStore((s) => s.asset);
  const spotPrice = usePortfolioStore((s) => s.spotPrice);
  const targetSpot = usePortfolioStore((s) => s.targetSpot);
  const targetDate = usePortfolioStore((s) => s.targetDate);
  const ivShift = usePortfolioStore((s) => s.ivShift);
  const rate = usePortfolioStore((s) => s.rate);
  const vix = usePortfolioStore((s) => s.vix);
  const marketLoading = usePortfolioStore((s) => s.marketLoading);
  const refreshMarket = usePortfolioStore((s) => s.refreshMarket);

  const currency = asset.currency;

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
  const mixedUnderlyings = useMemo(
    () => new Set(open.map((p) => p.instrument.toUpperCase())).size > 1,
    [open],
  );
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
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.brand}>
          <Image source={logo} style={styles.logo} />
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.appTitle}>TradeLikeHunter</Text>
            <Text style={styles.subtitle}>Payoff · Greeks · Strategies</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.spotBox} onPress={() => setPickerOpen(true)} activeOpacity={0.7}>
          <Text style={styles.instrument}>{asset.symbol} ▾</Text>
          <Text style={styles.spot}>{fmtNum(spotPrice, 1)}</Text>
          <Text style={styles.vix}>
            {marketLoading ? 'fetching…' : `${asset.vixLabel} ${vix != null ? fmtNum(vix, 1) + '%' : '—'} ↻`}
          </Text>
        </TouchableOpacity>
      </View>

      {tab !== 'PAPER' ? <RiskMatrix risk={risk} currency={currency} /> : null}

      {tab !== 'PAPER' && mixedUnderlyings ? (
        <View style={styles.warn}>
          <Text style={styles.warnTxt}>
            ⚠ Legs span multiple underlyings — the payoff plots them on one price axis, so combined
            numbers are only meaningful for a single instrument.
          </Text>
        </View>
      ) : null}

      {tab === 'PAPER' ? (
        <PaperTradingScreen />
      ) : tab === 'BACKTEST' ? (
        <TestingEngine />
      ) : tab === 'BROKERS' ? (
        <BrokersScreen />
      ) : tab === 'STRATEGY' ? (
        <StrategyLibrary onApplied={() => setTab('PAYOFF')} />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
          {tab === 'PAYOFF' && (
            <>
              <View style={styles.chartWrap}>
                <PayoffChart width={chartW} height={300} params={params} spot={spotPrice} targetSpot={targetSpot} strikes={strikes} breakevens={risk.breakevens} />
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

      {tab !== 'PAPER' && tab !== 'BACKTEST' && tab !== 'STRATEGY' && tab !== 'BROKERS' ? (
        <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 74 }]} onPress={openAdd} activeOpacity={0.85}>
          <Text style={styles.fabTxt}>＋ Add Contract</Text>
        </TouchableOpacity>
      ) : null}

      <BottomTabBar primary={PRIMARY_TABS} more={MORE_TABS} active={tab} onSelect={(k) => setTab(k as Tab)} />

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
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  logo: { width: 34, height: 34, borderRadius: 8 },
  appTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800' },
  subtitle: { color: theme.colors.textDim, fontSize: 11, marginTop: 2 },
  spotBox: { alignItems: 'flex-end' },
  instrument: { color: theme.colors.primary, fontSize: 13, fontWeight: '700' },
  spot: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  vix: { color: theme.colors.textDim, fontSize: 11, marginTop: 1 },
  tabBarWrap: { borderBottomColor: theme.colors.border, borderBottomWidth: 1 },
  tabBar: { paddingHorizontal: 4 },
  tab: { paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  tabTxt: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
  tabTxtActive: { color: theme.colors.text },
  tabUnderline: { height: 2, backgroundColor: theme.colors.primary, width: '80%', marginTop: 8, borderRadius: 2 },
  chartWrap: { paddingTop: 8 },
  warn: { backgroundColor: '#3a2a12', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  warnTxt: { color: '#F7941E', fontSize: 11, lineHeight: 16 },
  banner: { alignSelf: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4, marginBottom: 4 },
  bannerTxt: { color: theme.colors.textDim, fontSize: 12 },
  fab: { position: 'absolute', alignSelf: 'center', backgroundColor: theme.colors.primary, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 28 },
  fabTxt: { color: '#0B0E11', fontWeight: '700', fontSize: 15 },
});
