import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getHistory, type FyersCandle } from '../services/brokers/fyers';
import { generateBuyerSignals, type BuyerSignal } from '../services/buyerSignals';
import { generatePureSignals } from '../services/pureScanner';
import { liveFeed } from '../services/liveFeed';
import { buildChain, type ChainQuote, type ChainRow } from '../services/optionChain';
import { theme } from '../theme';
import { fmtNum } from '../utils/format';
import { fyersUnderlyingSymbol } from '../utils/options';
import { useBrokerStore } from '../store/useBrokerStore';
import { usePaperStore } from '../store/usePaperStore';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { synthCandles } from './PriceChart';

/**
 * 🔍 Option Buyer Scanner — the user's desktop "nifty-options-buyer" engine
 * running on live mobile data. Three completed-bar setups (Trend Breakout CE,
 * Breakdown PE, VWAP Reclaim/Rejection), confidence-scored with contract
 * quality gates, stop/target/lot sizing, and a one-tap BUY into the paper
 * order ticket.
 */
export function OptionScanner({
  rows,
  live,
  spot,
  refSpot,
  step,
  expiryIso,
  onTrade,
}: {
  rows: ChainRow[] | null;
  live: boolean;
  spot: number;
  refSpot: number;
  step: number;
  expiryIso: string;
  onTrade: (quote: ChainQuote, strike: number) => void;
}) {
  const asset = usePortfolioStore((s) => s.asset);
  const defaultIv = usePortfolioStore((s) => s.defaultIv);
  const vix = usePortfolioStore((s) => s.vix);
  const rate = usePortfolioStore((s) => s.rate);
  const fyers = useBrokerStore((s) => s.fyers);
  const startingFunds = usePaperStore((s) => s.startingFunds);
  const realizedPnl = usePaperStore((s) => s.realizedPnl);
  const fyersReady = !!(fyers.appId && fyers.accessToken) && asset.assetClass === 'india_equity';

  const [candles, setCandles] = useState<FyersCandle[]>([]);
  const [candleSrc, setCandleSrc] = useState<'live' | 'sim'>('sim');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mode, setMode] = useState<'pure' | 'engine'>('pure');

  // 5-minute candles for the signal engine (Fyers → synthetic fallback).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (fyersReady) {
        try {
          const to = new Date();
          const from = new Date(to.getTime() - 7 * 864e5);
          const rowsH = await getHistory(
            fyers.appId,
            fyers.accessToken!,
            fyersUnderlyingSymbol(asset),
            '5',
            from.toISOString().slice(0, 10),
            to.toISOString().slice(0, 10),
          );
          if (!cancelled && rowsH.length > 60) {
            setCandles(rowsH.slice(-160));
            setCandleSrc('live');
            return;
          }
        } catch {
          /* fall through to synthetic */
        }
      }
      if (!cancelled) {
        setCandles((prev) => (prev.length ? prev : synthCandles(liveFeed.getSpot() || spot || 100, 300, defaultIv, 160)));
        setCandleSrc('sim');
      }
    };
    load();
    const timer = setInterval(load, 45000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fyersReady, fyers.appId, fyers.accessToken, asset.symbol]);

  // Patch the forming candle from live ticks (the engine only uses completed bars).
  useEffect(() => {
    const unsub = liveFeed.subscribe((s) => {
      if (!(s > 0)) return;
      setCandles((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (s === last.c) return prev;
        return [...prev.slice(0, -1), { ...last, c: s, h: Math.max(last.h, s), l: Math.min(last.l, s) }];
      });
    });
    return unsub;
  }, []);

  const chainRows = useMemo(() => {
    if (rows && rows.length > 0) return rows;
    return buildChain({
      underlying: asset.symbol,
      spot,
      refSpot: refSpot > 0 ? refSpot : spot,
      iv: defaultIv,
      rate,
      expiryIso,
      step,
      strikesEachSide: 8,
    }).rows;
  }, [rows, asset.symbol, spot, refSpot, defaultIv, rate, expiryIso, step]);

  const scan = useMemo(() => {
    const common = {
      candles,
      rows: chainRows,
      spot,
      expiryIso,
      ivPct: vix ?? defaultIv * 100,
      lotSize: asset.lotSize,
      equity: startingFunds + realizedPnl,
      source: (live && candleSrc === 'live' ? 'fyers' : 'sim') as 'fyers' | 'sim',
    };
    return mode === 'pure'
      ? generatePureSignals({ ...common, step })
      : generateBuyerSignals(common);
  }, [mode, candles, chainRows, spot, step, expiryIso, vix, defaultIv, asset.lotSize, startingFunds, realizedPnl, live, candleSrc]);

  const ctx: any = scan.context;

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      {/* Engine mode */}
      <View style={styles.modeRow}>
        {(['pure', 'engine'] as const).map((m) => (
          <TouchableOpacity key={m} style={[styles.modeChip, mode === m && styles.modeOn]} onPress={() => setMode(m)}>
            <Text style={[styles.modeTxt, mode === m && styles.modeTxtOn]}>
              {m === 'pure' ? '⚡ Pure Price + OI' : 'Indicator Engine'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Gate + engine status */}
      <View style={[styles.gate, { borderColor: scan.gate.allowed ? theme.colors.profit : theme.colors.primary }]}>
        <Text style={[styles.gatePhase, { color: scan.gate.allowed ? theme.colors.profit : theme.colors.primary }]}>
          {scan.gate.phase}
        </Text>
        <Text style={styles.gateReason}>
          {scan.gate.reason} · {candleSrc === 'live' ? 'live Fyers 5-min candles' : 'sim candles'} ·{' '}
          {ctx ? `${ctx.barsUsed} bars` : 'warming up'}
        </Text>
      </View>

      {/* Market context strip */}
      {ctx && mode === 'pure' ? (
        <View style={styles.ctxGrid}>
          <Ctx label="VWAP" value={fmtNum(ctx.vwap, 0)} />
          <Ctx label="Open Range H/L" value={ctx.orh != null ? `${fmtNum(ctx.orh, 0)}/${fmtNum(ctx.orl, 0)}` : '—'} />
          <Ctx label="Prev Day H/L" value={ctx.pdh != null ? `${fmtNum(ctx.pdh, 0)}/${fmtNum(ctx.pdl, 0)}` : '—'} />
          <Ctx label="Range vs avg" value={`${fmtNum(ctx.avgRange ? ctx.lastRange / ctx.avgRange : 0, 2)}×`} />
          <Ctx label="Net ΔOI (ATM)" value={ctx.oiAvailable ? `${ctx.netOiBull >= 0 ? '+' : ''}${fmtNum(ctx.netOiBull / 1000, 0)}k` : 'n/a'} />
          <Ctx label="Exp. move" value={fmtNum(ctx.expectedMove, 0)} />
        </View>
      ) : ctx ? (
        <View style={styles.ctxGrid}>
          <Ctx label="EMA 9/21/50" value={`${fmtNum(ctx.ema9, 0)}/${fmtNum(ctx.ema21, 0)}/${fmtNum(ctx.ema50, 0)}`} />
          <Ctx label="RSI" value={fmtNum(ctx.rsi, 1)} />
          <Ctx label="ADX" value={fmtNum(ctx.adx, 1)} />
          <Ctx label="VWAP" value={fmtNum(ctx.vwap, 0)} />
          <Ctx label="20-bar Hi/Lo" value={`${fmtNum(ctx.recentHigh, 0)}/${fmtNum(ctx.recentLow, 0)}`} />
          <Ctx label="RVOL" value={ctx.rvolAvailable ? fmtNum(ctx.rvol, 2) : 'n/a'} />
        </View>
      ) : (
        <Text style={styles.warming}>
          Collecting 5-minute candles — {mode === 'pure' ? 'pure signals need 25' : 'engine needs 55'} completed bars…
        </Text>
      )}

      {/* Signals */}
      {scan.signals.length === 0 && ctx ? (
        <View style={styles.empty}>
          <Text style={styles.emptyBig}>No qualifying setup right now</Text>
          <Text style={styles.emptySmall}>
            The engine waits for a completed-bar breakout, breakdown or VWAP cross with a liquid ~0.42-delta
            contract. Patience is a position.
          </Text>
        </View>
      ) : null}

      {scan.signals.map((sig) => (
        <SignalCard
          key={sig.id}
          sig={sig}
          expanded={expanded === sig.id}
          onToggle={() => setExpanded(expanded === sig.id ? null : sig.id)}
          onBuy={() => onTrade(sig.contract.quote, sig.contract.strike)}
        />
      ))}

      <Text style={styles.disclaimer}>
        {mode === 'pure'
          ? 'Pure engine: opening-range / structure breaks + session VWAP + range-expansion momentum + OI-change confirmation on completed 5-min bars. No lagging indicators. ACTIVE only when all align — high bar by design.'
          : 'Indicator engine: Trend Breakout / Breakdown / VWAP Reclaim, ported from your nifty-options-buyer project.'}
        {'  '}For paper-trading practice — not investment advice.
      </Text>
    </ScrollView>
  );
}

function SignalCard({
  sig,
  expanded,
  onToggle,
  onBuy,
}: {
  sig: BuyerSignal;
  expanded: boolean;
  onToggle: () => void;
  onBuy: () => void;
}) {
  const statusColor =
    sig.status === 'ACTIVE' ? theme.colors.profit : sig.status === 'WATCH' ? theme.colors.primary : theme.colors.textFaint;
  const dirColor = sig.direction === 'BULLISH' ? theme.colors.profit : theme.colors.loss;
  return (
    <View style={[styles.card, { borderLeftColor: dirColor, borderLeftWidth: 3 }]}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {sig.title}
          </Text>
          <View style={[styles.statusChip, { backgroundColor: statusColor + '22' }]}>
            <Text style={[styles.statusTxt, { color: statusColor }]}>{sig.status}</Text>
          </View>
        </View>
        <Text style={styles.cardSym}>
          {fmtNum(sig.contract.strike, 0)} {sig.contract.optType} · Δ {fmtNum(Math.abs(sig.contract.delta), 2)} · conf{' '}
          <Text style={{ color: statusColor, fontWeight: '800' }}>{sig.confidence}</Text>/96
        </Text>
        <View style={styles.levels}>
          <Lv label="Entry" value={fmtNum(sig.entry, 2)} />
          <Lv label="SL" value={fmtNum(sig.stopLoss, 2)} color={theme.colors.loss} />
          <Lv label="Target" value={fmtNum(sig.target, 2)} color={theme.colors.profit} />
          <Lv label="R:R" value={`1:${sig.riskReward}`} />
          <Lv label="Lots" value={String(sig.suggestedLots)} />
        </View>
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.detail}>
          {sig.blockers.length > 0 ? (
            <Text style={styles.blockers}>⛔ {sig.blockers.join(' · ')}</Text>
          ) : null}
          {sig.reasons.map((r, i) => (
            <Text key={i} style={styles.reason}>
              • {r}
            </Text>
          ))}
          <Text style={styles.invalidation}>Invalidation: {sig.invalidation}</Text>
          <Text style={styles.meta}>
            Max risk ≈ {fmtNum(sig.maxRiskInr, 0)} · hold ≤ {sig.holdingMinutes}m · OI {fmtNum(sig.contract.oi / 1e5, 1)}L
            · spread {fmtNum(sig.contract.spreadPct, 2)}%{sig.contract.estimated ? ' · liquidity estimated' : ''}
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.buyBtn, sig.status !== 'ACTIVE' && { backgroundColor: theme.colors.surfaceAlt }]}
        onPress={onBuy}
        activeOpacity={0.85}
      >
        <Text style={[styles.buyTxt, sig.status !== 'ACTIVE' && { color: theme.colors.textDim }]}>
          {sig.status === 'ACTIVE' ? `⚡ BUY ${sig.suggestedLots > 0 ? `${sig.suggestedLots} lot` : ''}` : 'Paper trade anyway'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function Ctx({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.ctx}>
      <Text style={styles.ctxLabel}>{label}</Text>
      <Text style={styles.ctxVal}>{value}</Text>
    </View>
  );
}

function Lv({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.lvLabel}>{label}</Text>
      <Text style={[styles.lvVal, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  modeChip: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  modeOn: { backgroundColor: theme.colors.primaryDim, borderColor: theme.colors.primary },
  modeTxt: { color: theme.colors.textDim, fontSize: 12, fontWeight: '700' },
  modeTxtOn: { color: theme.colors.text },
  gate: { backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, padding: 10 },
  gatePhase: { fontSize: 12, fontWeight: '800' },
  gateReason: { color: theme.colors.textDim, fontSize: 11, marginTop: 3 },
  ctxGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  ctx: { flexBasis: '31%', flexGrow: 1, backgroundColor: theme.colors.surface, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: 6, paddingHorizontal: 8 },
  ctxLabel: { color: theme.colors.textFaint, fontSize: 9, marginBottom: 2 },
  ctxVal: { color: theme.colors.text, fontSize: 12, fontWeight: '700' },
  warming: { color: theme.colors.textDim, fontSize: 12, marginTop: 12, lineHeight: 17 },
  empty: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 16, marginTop: 12, alignItems: 'center' },
  emptyBig: { color: theme.colors.text, fontSize: 14, fontWeight: '700', marginBottom: 6 },
  emptySmall: { color: theme.colors.textDim, fontSize: 12, textAlign: 'center', lineHeight: 17 },
  card: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 12, marginTop: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '800', flex: 1 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusTxt: { fontSize: 10, fontWeight: '800' },
  cardSym: { color: theme.colors.textDim, fontSize: 11, marginTop: 4 },
  levels: { flexDirection: 'row', marginTop: 10, gap: 6 },
  lvLabel: { color: theme.colors.textFaint, fontSize: 9, marginBottom: 2 },
  lvVal: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  detail: { borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 10, paddingTop: 8 },
  blockers: { color: theme.colors.loss, fontSize: 11, marginBottom: 6, lineHeight: 15 },
  reason: { color: theme.colors.textDim, fontSize: 11, lineHeight: 16, marginBottom: 3 },
  invalidation: { color: theme.colors.primary, fontSize: 11, marginTop: 4, lineHeight: 15 },
  meta: { color: theme.colors.textFaint, fontSize: 10, marginTop: 6 },
  buyBtn: { backgroundColor: theme.colors.buy, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  buyTxt: { color: '#0B0E11', fontSize: 13, fontWeight: '800' },
  disclaimer: { color: theme.colors.textFaint, fontSize: 10, lineHeight: 15, marginTop: 14 },
});
