import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { niceStrikeStep } from '../constants/instruments';
import type { Strategy } from '../constants/strategies';
import { getOptionChain, getQuotes, type FyersExpiry } from '../services/brokers/fyers';
import { liveFeed, type FeedSource } from '../services/liveFeed';
import { atmStrikeFor, fyersChainToRows, priceContract, type ChainQuote, type ChainRow } from '../services/optionChain';
import { theme } from '../theme';
import type { OptionAction } from '../types';
import { daysBetween, fmtCompact, fmtNum } from '../utils/format';
import { displayOptionSymbol, expiryTag, fyersUnderlyingSymbol, optionKey, upcomingExpiries } from '../utils/options';
import { useBrokerStore } from '../store/useBrokerStore';
import { usePortfolioStore } from '../store/usePortfolioStore';
import {
  positionMargin,
  positionPnl,
  usePaperStore,
  type Contract,
} from '../store/usePaperStore';
import { OptionChain } from './OptionChain';
import { OrderTicket } from './OrderTicket';
import { PaperJournal } from './PaperJournal';
import { PaperOrders, PaperPositions } from './PaperPositions';
import { OptionScanner } from './OptionScanner';
import { PaperStrategyDeploy } from './PaperStrategyDeploy';
import { PriceChart } from './PriceChart';
import { SectionNav } from './SectionNav';
import { StrategyDeploySheet, type ResolvedLeg } from './StrategyDeploySheet';

type SubTab = 'CHAIN' | 'CHART' | 'SCANNER' | 'STRATEGY' | 'POSITIONS' | 'ORDERS' | 'JOURNAL';

/**
 * Paper Trading — a live option chain (Market-Pulse style) wired to a virtual
 * order engine. Prices stream from the underlying spot (real Fyers ticks when
 * connected, otherwise a live simulated tape) and every fill / position marks
 * to market exactly like a real trade, with zero money at risk.
 */
export function PaperTradingScreen() {
  const asset = usePortfolioStore((s) => s.asset);
  const spotPrice = usePortfolioStore((s) => s.spotPrice);
  const defaultIv = usePortfolioStore((s) => s.defaultIv);
  const rate = usePortfolioStore((s) => s.rate);
  const fyers = useBrokerStore((s) => s.fyers);

  const positions = usePaperStore((s) => s.positions);
  const realizedPnl = usePaperStore((s) => s.realizedPnl);
  const startingFunds = usePaperStore((s) => s.startingFunds);
  const chargesEnabled = usePaperStore((s) => s.chargesEnabled);
  const setChargesEnabled = usePaperStore((s) => s.setChargesEnabled);
  const setStartingFunds = usePaperStore((s) => s.setStartingFunds);
  const resetPaper = usePaperStore((s) => s.resetPaper);

  const [subTab, setSubTab] = useState<SubTab>('CHAIN');
  const [spot, setSpot] = useState(spotPrice > 0 ? spotPrice : 0);
  const [source, setSource] = useState<FeedSource>('sim');
  const [refSpot, setRefSpot] = useState(0);
  const [ticket, setTicket] = useState<{ contract: Contract; action: OptionAction; ltp: number } | null>(null);
  const [fundsDraft, setFundsDraft] = useState(String(startingFunds));

  // Real Fyers chain state (populated only when connected to the Indian market).
  const [fyersRows, setFyersRows] = useState<ChainRow[] | null>(null);
  const [fyersAtm, setFyersAtm] = useState(0);
  const [fyersExpiries, setFyersExpiries] = useState<FyersExpiry[]>([]);
  const [chainErr, setChainErr] = useState<string | null>(null);
  const [chainState, setChainState] = useState<'idle' | 'live' | 'error'>('idle');
  const [chainAt, setChainAt] = useState<number | null>(null);
  const expiriesRef = useRef<FyersExpiry[]>([]);

  const fyersConnected = !!(fyers.appId && fyers.accessToken);
  const useFyers = fyersConnected && asset.assetClass === 'india_equity';

  const [expiryIso, setExpiryIso] = useState(upcomingExpiries(asset, 6)[0]);
  const step = asset.strikeStep > 0 ? asset.strikeStep : niceStrikeStep(spot || spotPrice || 1);

  // Reset the session reference + expiry + cached chain when the underlying changes.
  useEffect(() => {
    setRefSpot(0);
    setExpiryIso(upcomingExpiries(asset, 6)[0]);
    expiriesRef.current = [];
    setFyersExpiries([]);
    setFyersRows(null);
    setChainErr(null);
    setChainState('idle');
  }, [asset.symbol]);

  // Seed the walk around the last known spot and capture the day's reference.
  useEffect(() => {
    const vol = Math.min(Math.max(defaultIv, 0.05), 1.5);
    liveFeed.setBase(spotPrice, vol);
    if (spotPrice > 0) {
      setSpot((prev) => (prev > 0 ? prev : spotPrice));
      setRefSpot((prev) => (prev > 0 ? prev : spotPrice));
    }
  }, [spotPrice, defaultIv]);

  // Start the tape and pump every tick into the paper engine.
  useEffect(() => {
    liveFeed.start();
    const unsub = liveFeed.subscribe((s, src) => {
      setSpot(s);
      setSource(src);
      usePaperStore.getState().onSpot(s);
    });
    return () => {
      unsub();
      liveFeed.stop();
    };
  }, []);

  // Poll the real Fyers option chain when connected to the Indian market.
  useEffect(() => {
    if (!useFyers) {
      setFyersRows(null);
      return;
    }
    let cancelled = false;
    const symbol = fyersUnderlyingSymbol(asset);

    const tick = async () => {
      try {
        const epoch = expiriesRef.current.find((e) => e.iso === expiryIso)?.epoch;
        const chain = await getOptionChain(fyers.appId, fyers.accessToken!, symbol, 12, epoch);
        if (cancelled) return;
        if (chain.expiries.length) {
          expiriesRef.current = chain.expiries;
          setFyersExpiries(chain.expiries);
        }
        if (chain.underlyingLtp > 0) liveFeed.pushExternalSpot(chain.underlyingLtp);
        if (chain.underlyingPrevClose > 0) setRefSpot(chain.underlyingPrevClose);
        // Keep the selected expiry valid against the broker's real list.
        const validExpiry = chain.expiries.find((e) => e.iso === expiryIso)?.iso ?? chain.expiries[0]?.iso ?? expiryIso;
        if (validExpiry !== expiryIso) setExpiryIso(validExpiry);
        const mapped = fyersChainToRows(chain, asset.symbol, validExpiry, defaultIv, rate);
        setFyersRows(mapped.rows);
        setFyersAtm(mapped.atm);
        setChainErr(null);
        setChainState('live');
        setChainAt(Date.now());
      } catch (e) {
        if (!cancelled) {
          setChainErr((e as Error).message);
          setChainState('error');
        }
      }
    };

    tick();
    const timer = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [useFyers, fyers.appId, fyers.accessToken, asset.symbol, expiryIso, defaultIv, rate]);

  // Poll real broker LTPs for open positions + resting orders so they mark to
  // the live market (not the Black-Scholes tape) when Fyers is connected.
  useEffect(() => {
    if (!fyersConnected) return;
    let cancelled = false;
    const poll = async () => {
      const st = usePaperStore.getState();
      const syms = new Set<string>();
      for (const p of st.positions) if (p.symbol.includes(':')) syms.add(p.symbol);
      for (const o of st.orders) if (o.status === 'PENDING' && o.symbol.includes(':')) syms.add(o.symbol);
      if (syms.size === 0) return;
      try {
        const map = await getQuotes(fyers.appId, fyers.accessToken!, [...syms]);
        if (!cancelled && Object.keys(map).length) usePaperStore.getState().applyLtps(map);
      } catch {
        /* ignore — BS tape keeps positions live in the meantime */
      }
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [fyersConnected, fyers.appId, fyers.accessToken]);

  const onSelect = (quote: ChainQuote, strike: number) => {
    setTicket({
      action: 'BUY',
      // Snapshot the real chain LTP when connected so the fill matches what was tapped.
      ltp: realChain ? quote.ltp : 0,
      contract: {
        key: quote.key,
        symbol: quote.symbol,
        underlying: asset.symbol,
        strike,
        optType: quote.type,
        expiryIso,
        lotSize: asset.lotSize,
        iv: defaultIv,
        rate,
      },
    });
  };

  // Strategy deploy: resolve live strikes/prices → preview sheet → confirm.
  const resolveLegs = (strategy: Strategy): (ResolvedLeg & { key: string })[] => {
    const atm = atmStrikeFor(spot, step);
    return strategy.legs.map((leg) => {
      const strike = Math.max(atm + leg.stepOffset * step, step);
      // Calendar legs use a later expiry; everything else uses the selected one.
      let legExpiry = expiryIso;
      if (leg.dteOffset) {
        const later = expiryList.find((e) => daysBetween(expiryIso, e.iso) >= leg.dteOffset!);
        legExpiry = later?.iso ?? expiryIso;
      }
      // Prefer the live chain quote (real LTP + Fyers symbol) for the near expiry.
      const row = legExpiry === expiryIso && realChain ? fyersRows!.find((r) => r.strike === strike) : undefined;
      const q = row ? (leg.type === 'CALL' ? row.call : row.put) : undefined;
      return {
        action: leg.action,
        optType: leg.type,
        ratio: leg.ratio,
        strike,
        expiryIso: legExpiry,
        ltp: q?.ltp ?? priceContract(spot, strike, leg.type, legExpiry, defaultIv, rate),
        symbol: q?.symbol ?? displayOptionSymbol(asset.symbol, legExpiry, strike, leg.type),
        key: q?.key ?? optionKey(asset.symbol, legExpiry, strike, leg.type),
      };
    });
  };

  const [deployReq, setDeployReq] = useState<{
    name: string;
    legs: (ResolvedLeg & { key: string })[];
    lots: number;
  } | null>(null);

  const requestDeploy = (strategy: Strategy, baseLots: number) =>
    setDeployReq({ name: strategy.name, legs: resolveLegs(strategy), lots: baseLots });

  const confirmDeploy = (lots: number, lotSize: number) => {
    if (!deployReq) return;
    const place = usePaperStore.getState().placeOrder;
    for (const leg of deployReq.legs) {
      place(
        {
          key: leg.key,
          symbol: leg.symbol,
          underlying: asset.symbol,
          strike: leg.strike,
          optType: leg.optType,
          expiryIso: leg.expiryIso,
          lotSize,
          iv: defaultIv,
          rate,
          action: leg.action,
          orderType: 'MARKET',
          product: 'NRML',
          lots: leg.ratio * lots,
        },
        leg.ltp,
      );
    }
    setDeployReq(null);
    setSubTab('POSITIONS');
  };

  const unrealized = positions.reduce((a, p) => a + positionPnl(p), 0);
  const usedMargin = positions.reduce((a, p) => a + positionMargin(p), 0);
  const equity = startingFunds + realizedPnl + unrealized;
  const available = startingFunds + realizedPnl - usedMargin;
  const dayPnl = realizedPnl + unrealized;
  const currency = asset.currency;
  const live = source === 'live';
  const realChain = useFyers && !!fyersRows && fyersRows.length > 0;

  // Expiry chips: real Fyers expiries when connected, else synthetic weeklies.
  const expiryList: { iso: string; label: string }[] =
    useFyers && fyersExpiries.length > 0
      ? fyersExpiries.map((e) => ({ iso: e.iso, label: e.label || expiryTag(e.iso) }))
      : upcomingExpiries(asset, 6).map((iso) => ({ iso, label: expiryTag(iso) }));

  return (
    <View style={styles.root}>
      {/* Funds / mode strip */}
      <View style={styles.strip}>
        <View style={styles.stripLeft}>
          <View style={styles.paperBadge}>
            <Text style={styles.paperTxt}>PAPER</Text>
          </View>
          <View style={[styles.liveDot, { backgroundColor: realChain ? theme.colors.profit : live ? theme.colors.profit : theme.colors.primary }]} />
          <Text style={styles.modeTxt}>{realChain ? 'LIVE · Fyers chain' : live ? 'LIVE · Fyers' : 'SIM feed'}</Text>
        </View>
        <TouchableOpacity onPress={resetPaper} hitSlop={8}>
          <Text style={styles.reset}>↺ Reset</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.fundsRow}>
        <Fund label="Equity" value={`${fmtCompact(equity)}`} />
        <Fund label="Available" value={`${fmtCompact(available)}`} />
        <Fund
          label="Day P&L"
          value={`${dayPnl >= 0 ? '+' : ''}${fmtNum(dayPnl, 0)}`}
          color={dayPnl >= 0 ? theme.colors.profit : theme.colors.loss}
        />
      </View>

      {/* Instrument + spot */}
      <View style={styles.spotRow}>
        <Text style={styles.instr}>
          {asset.symbol} <Text style={styles.spotVal}>{fmtNum(spot, spot >= 100 ? 1 : 2)}</Text>
        </Text>
        <Text style={[styles.spotChg, { color: spot - refSpot >= 0 ? theme.colors.profit : theme.colors.loss }]}>
          {spot - refSpot >= 0 ? '+' : ''}
          {fmtNum(spot - refSpot, 1)} ({refSpot > 0 ? fmtNum(((spot - refSpot) / refSpot) * 100, 2) : '0.00'}%)
        </Text>
      </View>

      {/* Expiry chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.expiryScroll}
        contentContainerStyle={styles.expiryRow}
      >
        {expiryList.map((e) => (
          <TouchableOpacity
            key={e.iso}
            style={[styles.expChip, expiryIso === e.iso && styles.expChipOn]}
            onPress={() => setExpiryIso(e.iso)}
          >
            <Text style={[styles.expTxt, expiryIso === e.iso && styles.expTxtOn]}>{e.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {/* Fyers chain diagnostics */}
      {fyersConnected && !useFyers ? (
        <Text style={styles.chainHint}>
          Live Fyers chain is available for NIFTY · BANKNIFTY · SENSEX. {asset.symbol} shows a simulated chain.
        </Text>
      ) : useFyers && chainState === 'error' ? (
        <Text style={styles.chainErr}>
          ⚠ Fyers: {chainErr}. Ensure your Fyers app has the “Quotes & Market data” permission enabled.
        </Text>
      ) : useFyers && realChain ? (
        <Text style={styles.chainLive}>
          ● Fyers LIVE · {fyersRows!.length} strikes{chainAt ? ` · ${new Date(chainAt).toLocaleTimeString()}` : ''}
        </Text>
      ) : useFyers ? (
        <Text style={styles.chainHint}>Connecting to Fyers option chain…</Text>
      ) : null}

      {/* Collapsible sub-nav — the selected view runs full-screen below */}
      <SectionNav
        columns={4}
        active={subTab}
        onSelect={(k) => setSubTab(k as SubTab)}
        items={[
          { key: 'CHAIN', label: 'Chain', icon: '⛓️' },
          { key: 'CHART', label: 'Chart', icon: '📈' },
          { key: 'SCANNER', label: 'Scanner', icon: '🔍' },
          { key: 'STRATEGY', label: 'Strategy', icon: '🎯' },
          { key: 'POSITIONS', label: positions.length ? `Positions ${positions.length}` : 'Positions', icon: '📂' },
          { key: 'ORDERS', label: 'Orders', icon: '🧾' },
          { key: 'JOURNAL', label: 'Journal', icon: '📊' },
        ]}
      />

      {subTab === 'CHAIN' ? (
        <OptionChain
          underlying={asset.symbol}
          spot={spot}
          refSpot={refSpot > 0 ? refSpot : spot}
          iv={defaultIv}
          rate={rate}
          step={step}
          expiryIso={expiryIso}
          externalRows={realChain ? fyersRows! : undefined}
          externalAtm={realChain ? fyersAtm : undefined}
          onSelect={onSelect}
        />
      ) : subTab === 'CHART' ? (
        <PriceChart />
      ) : subTab === 'SCANNER' ? (
        <OptionScanner
          rows={realChain ? fyersRows : null}
          live={realChain}
          spot={spot}
          refSpot={refSpot > 0 ? refSpot : spot}
          step={step}
          expiryIso={expiryIso}
          onTrade={onSelect}
        />
      ) : subTab === 'STRATEGY' ? (
        <PaperStrategyDeploy live={realChain} onDeploy={requestDeploy} />
      ) : subTab === 'JOURNAL' ? (
        <PaperJournal currency={currency} />
      ) : subTab === 'POSITIONS' ? (
        <PaperPositions currency={currency} spot={spot} rate={rate} />
      ) : (
        <View style={{ flex: 1 }}>
          <PaperOrders />
          <View style={styles.fundsEditRow}>
            <Text style={styles.chargesTxt}>Starting capital ({currency})</Text>
            <View style={styles.fundsEditRight}>
              <TextInput
                style={styles.fundsInput}
                value={fundsDraft}
                onChangeText={setFundsDraft}
                keyboardType="number-pad"
                selectTextOnFocus
              />
              <TouchableOpacity
                style={styles.applyBtn}
                onPress={() => {
                  const n = Math.max(0, Math.floor(Number(fundsDraft) || 0));
                  setStartingFunds(n);
                  setFundsDraft(String(n));
                }}
              >
                <Text style={styles.applyTxt}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.chargesRow}>
            <Text style={styles.chargesTxt}>Apply estimated brokerage & taxes</Text>
            <Switch
              value={chargesEnabled}
              onValueChange={setChargesEnabled}
              trackColor={{ true: theme.colors.primaryDim, false: theme.colors.border }}
              thumbColor={chargesEnabled ? theme.colors.primary : theme.colors.textDim}
            />
          </View>
        </View>
      )}

      <OrderTicket
        visible={!!ticket}
        contract={ticket?.contract ?? null}
        initialAction={ticket?.action ?? 'BUY'}
        liveLtp={ticket?.ltp ?? 0}
        spot={spot}
        currency={currency}
        onClose={() => setTicket(null)}
      />
      <StrategyDeploySheet
        visible={!!deployReq}
        name={deployReq?.name ?? ''}
        legs={deployReq?.legs ?? []}
        initialLots={deployReq?.lots ?? 1}
        defaultLotSize={asset.lotSize}
        currency={currency}
        live={realChain}
        onConfirm={confirmDeploy}
        onClose={() => setDeployReq(null)}
      />
    </View>
  );
}

function Fund({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.fund}>
      <Text style={styles.fundLabel}>{label}</Text>
      <Text style={[styles.fundVal, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  strip: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8 },
  stripLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paperBadge: { backgroundColor: theme.colors.primary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 5 },
  paperTxt: { color: '#0B0E11', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  modeTxt: { color: theme.colors.textDim, fontSize: 12, fontWeight: '600' },
  reset: { color: theme.colors.textDim, fontSize: 12, fontWeight: '600' },
  fundsRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  fund: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: 8, paddingHorizontal: 10 },
  fundLabel: { color: theme.colors.textDim, fontSize: 10, marginBottom: 3 },
  fundVal: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
  spotRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 14, marginBottom: 6 },
  instr: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  spotVal: { color: theme.colors.text, fontSize: 16, fontWeight: '800' },
  spotChg: { fontSize: 12, fontWeight: '600' },
  expiryScroll: { maxHeight: 42 },
  expiryRow: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  expChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  expChipOn: { backgroundColor: theme.colors.primaryDim, borderColor: theme.colors.primary },
  expTxt: { color: theme.colors.textDim, fontSize: 12, fontWeight: '600' },
  expTxtOn: { color: theme.colors.text },
  chainErr: { color: theme.colors.loss, fontSize: 11, paddingHorizontal: 14, paddingTop: 4, lineHeight: 15 },
  chainHint: { color: theme.colors.textDim, fontSize: 11, paddingHorizontal: 14, paddingTop: 4, lineHeight: 15 },
  chainLive: { color: theme.colors.profit, fontSize: 11, fontWeight: '700', paddingHorizontal: 14, paddingTop: 4 },
  subTabsWrap: { borderBottomWidth: 1, borderBottomColor: theme.colors.border, marginTop: 8 },
  subTabs: { paddingHorizontal: 4 },
  subTab: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  subTabTxt: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
  subTabTxtOn: { color: theme.colors.text },
  subUnderline: { height: 2, backgroundColor: theme.colors.primary, width: '60%', marginTop: 8, borderRadius: 2 },
  chargesRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.colors.border },
  chargesTxt: { color: theme.colors.textDim, fontSize: 12 },
  fundsEditRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.colors.border },
  fundsEditRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fundsInput: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: theme.colors.text, fontSize: 14, fontWeight: '700', minWidth: 110, textAlign: 'right' },
  applyBtn: { backgroundColor: theme.colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  applyTxt: { color: '#0B0E11', fontSize: 13, fontWeight: '800' },
});
