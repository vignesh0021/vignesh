import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { niceStrikeStep } from '../constants/instruments';
import { liveFeed, type FeedSource } from '../services/liveFeed';
import type { ChainQuote } from '../services/optionChain';
import { theme } from '../theme';
import type { OptionAction } from '../types';
import { fmtCompact, fmtNum } from '../utils/format';
import { expiryTag, fyersUnderlyingSymbol, upcomingExpiries } from '../utils/options';
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
import { PaperOrders, PaperPositions } from './PaperPositions';

type SubTab = 'CHAIN' | 'POSITIONS' | 'ORDERS';

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
  const [ticket, setTicket] = useState<{ contract: Contract; action: OptionAction } | null>(null);
  const [fundsDraft, setFundsDraft] = useState(String(startingFunds));

  const expiries = useMemo(() => upcomingExpiries(asset, 6), [asset]);
  const [expiryIso, setExpiryIso] = useState(expiries[0]);
  const step = asset.strikeStep > 0 ? asset.strikeStep : niceStrikeStep(spot || spotPrice || 1);

  // Reset the session reference + expiry when the underlying changes.
  useEffect(() => {
    setRefSpot(0);
    setExpiryIso(upcomingExpiries(asset, 6)[0]);
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

  // Attach / detach the real Fyers data socket when credentials change.
  useEffect(() => {
    if (fyers.appId && fyers.accessToken) {
      liveFeed.connectFyers(fyers.appId, fyers.accessToken, fyersUnderlyingSymbol(asset));
    } else {
      liveFeed.disconnectFyers();
    }
    return () => liveFeed.disconnectFyers();
  }, [fyers.appId, fyers.accessToken, asset.symbol]);

  const onSelect = (quote: ChainQuote, strike: number) => {
    setTicket({
      action: 'BUY',
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

  const unrealized = positions.reduce((a, p) => a + positionPnl(p), 0);
  const usedMargin = positions.reduce((a, p) => a + positionMargin(p), 0);
  const equity = startingFunds + realizedPnl + unrealized;
  const available = startingFunds + realizedPnl - usedMargin;
  const dayPnl = realizedPnl + unrealized;
  const currency = asset.currency;
  const live = source === 'live';

  return (
    <View style={styles.root}>
      {/* Funds / mode strip */}
      <View style={styles.strip}>
        <View style={styles.stripLeft}>
          <View style={styles.paperBadge}>
            <Text style={styles.paperTxt}>PAPER</Text>
          </View>
          <View style={[styles.liveDot, { backgroundColor: live ? theme.colors.profit : theme.colors.primary }]} />
          <Text style={styles.modeTxt}>{live ? 'LIVE · Fyers' : 'SIM feed'}</Text>
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
        {expiries.map((e) => (
          <TouchableOpacity
            key={e}
            style={[styles.expChip, expiryIso === e && styles.expChipOn]}
            onPress={() => setExpiryIso(e)}
          >
            <Text style={[styles.expTxt, expiryIso === e && styles.expTxtOn]}>{expiryTag(e)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Sub tabs */}
      <View style={styles.subTabs}>
        {(['CHAIN', 'POSITIONS', 'ORDERS'] as SubTab[]).map((t) => (
          <TouchableOpacity key={t} style={styles.subTab} onPress={() => setSubTab(t)}>
            <Text style={[styles.subTabTxt, subTab === t && styles.subTabTxtOn]}>
              {t === 'CHAIN' ? 'Option Chain' : t === 'POSITIONS' ? `Positions${positions.length ? ` (${positions.length})` : ''}` : 'Orders'}
            </Text>
            {subTab === t ? <View style={styles.subUnderline} /> : null}
          </TouchableOpacity>
        ))}
      </View>

      {subTab === 'CHAIN' ? (
        <OptionChain
          underlying={asset.symbol}
          spot={spot}
          refSpot={refSpot > 0 ? refSpot : spot}
          iv={defaultIv}
          rate={rate}
          step={step}
          expiryIso={expiryIso}
          onSelect={onSelect}
        />
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
        spot={spot}
        currency={currency}
        onClose={() => setTicket(null)}
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
  subTabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.border, marginTop: 8 },
  subTab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
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
