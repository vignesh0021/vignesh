import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getHistory, type FyersCandle } from '../services/brokers/fyers';
import { liveFeed } from '../services/liveFeed';
import { atmStrikeFor, buildChain, type ChainQuote, type ChainRow } from '../services/optionChain';
import { theme } from '../theme';
import { fmtNum } from '../utils/format';
import { ema, rsi as rsiCalc, vwap as vwapCalc } from '../utils/indicators';
import { fyersUnderlyingSymbol } from '../utils/options';
import { useBrokerStore } from '../store/useBrokerStore';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { synthCandles } from './PriceChart';

/**
 * Option Buying Scanner — answers "which option should a buyer look at RIGHT
 * NOW?" from live data. Direction comes from 5-minute price action on the
 * underlying (EMA 9/21 trend, RSI 14, VWAP side, 5-bar momentum); candidates
 * are then ranked from the live chain by premium momentum on the biased side,
 * each with a one-tap BUY that opens the order ticket.
 */

type Bias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

interface Signal {
  label: string;
  value: string;
  dir: 1 | 0 | -1; // bullish / neutral / bearish contribution
}

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
  const rate = usePortfolioStore((s) => s.rate);
  const fyers = useBrokerStore((s) => s.fyers);
  const fyersReady = !!(fyers.appId && fyers.accessToken) && asset.assetClass === 'india_equity';

  const [candles, setCandles] = useState<FyersCandle[]>([]);
  const [candleSrc, setCandleSrc] = useState<'live' | 'sim'>('sim');

  // 5-minute candles for the direction engine (Fyers → synthetic fallback).
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
          if (!cancelled && rowsH.length > 30) {
            setCandles(rowsH.slice(-80));
            setCandleSrc('live');
            return;
          }
        } catch {
          /* fall through to synthetic */
        }
      }
      if (!cancelled) {
        setCandles((prev) => (prev.length ? prev : synthCandles(liveFeed.getSpot() || spot || 100, 300, defaultIv)));
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

  // Patch the forming candle from live ticks so signals stay current.
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

  // ---- direction engine ---------------------------------------------------
  const { bias, score, signals } = useMemo(() => {
    const closes = candles.map((c) => c.c);
    if (closes.length < 25) {
      return { bias: 'NEUTRAL' as Bias, score: 0, signals: [] as Signal[] };
    }
    const e9 = ema(closes, 9), e21 = ema(closes, 21);
    const r = rsiCalc(closes, 14);
    const vw = vwapCalc(candles);
    const i = closes.length - 1;
    const lastE9 = e9[i] ?? 0, lastE21 = e21[i] ?? 0;
    const lastR = r[i] ?? 50;
    const lastVw = vw[i] ?? closes[i];
    const roc5 = closes[i - 5] > 0 ? ((closes[i] - closes[i - 5]) / closes[i - 5]) * 100 : 0;

    const sigs: Signal[] = [
      { label: 'Trend (EMA 9/21)', value: lastE9 > lastE21 ? 'Up' : lastE9 < lastE21 ? 'Down' : 'Flat', dir: lastE9 > lastE21 ? 1 : lastE9 < lastE21 ? -1 : 0 },
      { label: 'RSI 14', value: fmtNum(lastR, 0), dir: lastR >= 55 && lastR <= 78 ? 1 : lastR <= 45 && lastR >= 22 ? -1 : 0 },
      { label: 'VWAP', value: closes[i] >= lastVw ? 'Above' : 'Below', dir: closes[i] >= lastVw ? 1 : -1 },
      { label: 'Momentum (5 bars)', value: `${roc5 >= 0 ? '+' : ''}${fmtNum(roc5, 2)}%`, dir: roc5 > 0.08 ? 1 : roc5 < -0.08 ? -1 : 0 },
    ];

    let bull = 0, bear = 0;
    // Trend carries double weight — buyers need the tide, not just ripples.
    for (const [idx, s] of sigs.entries()) {
      const w = idx === 0 ? 2 : 1;
      if (s.dir === 1) bull += w;
      else if (s.dir === -1) bear += w;
    }
    const b: Bias = bull - bear >= 2 ? 'BULLISH' : bear - bull >= 2 ? 'BEARISH' : 'NEUTRAL';
    return { bias: b, score: Math.max(bull, bear), signals: sigs };
  }, [candles]);

  // ---- candidate strikes --------------------------------------------------
  const chainRows = useMemo(() => {
    if (rows && rows.length > 0) return rows;
    // Offline: synthesize so the scanner still teaches the flow.
    return buildChain({
      underlying: asset.symbol,
      spot,
      refSpot: refSpot > 0 ? refSpot : spot,
      iv: defaultIv,
      rate,
      expiryIso,
      step,
      strikesEachSide: 6,
    }).rows;
  }, [rows, asset.symbol, spot, refSpot, defaultIv, rate, expiryIso, step]);

  const candidates = useMemo(() => {
    const atm = atmStrikeFor(spot, step);
    const side: 'CALL' | 'PUT' | null = bias === 'BULLISH' ? 'CALL' : bias === 'BEARISH' ? 'PUT' : null;
    const offs = side === 'CALL' ? [-1, 0, 1, 2] : [1, 0, -1, -2]; // ITM → ATM → OTM on the biased side
    const wanted = side ? offs.map((o) => atm + o * step) : [atm];
    const out: { quote: ChainQuote; strike: number; chgPct: number; tag: string }[] = [];
    for (const strike of wanted) {
      const row = chainRows.find((r) => r.strike === strike);
      if (!row) continue;
      const pick = (q: ChainQuote) => {
        const base = q.ltp - q.chg;
        const chgPct = base > 0 ? (q.chg / base) * 100 : 0;
        const tag = strike === atm ? 'ATM' : q.itm ? 'ITM' : 'OTM';
        out.push({ quote: q, strike, chgPct, tag });
      };
      if (side === 'CALL' || side === null) pick(row.call);
      if (side === 'PUT' || side === null) pick(row.put);
    }
    // Rank by premium momentum in the direction of the bias.
    return out.sort((a, b) => b.chgPct - a.chgPct);
  }, [chainRows, spot, step, bias]);

  const biasColor = bias === 'BULLISH' ? theme.colors.profit : bias === 'BEARISH' ? theme.colors.loss : theme.colors.textDim;

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      {/* Verdict */}
      <View style={[styles.verdict, { borderColor: biasColor }]}>
        <Text style={[styles.verdictBias, { color: biasColor }]}>
          {bias === 'BULLISH' ? '▲ BULLISH — look at Calls' : bias === 'BEARISH' ? '▼ BEARISH — look at Puts' : '◆ NEUTRAL — no clear edge'}
        </Text>
        <Text style={styles.verdictSub}>
          {asset.symbol} {fmtNum(spot, 1)} · 5-min price action · strength {score}/5 ·{' '}
          {candleSrc === 'live' ? 'live Fyers candles' : 'sim candles'}
        </Text>
      </View>

      {/* Signals */}
      <View style={styles.sigGrid}>
        {signals.map((s) => (
          <View key={s.label} style={[styles.sig, { borderColor: s.dir === 1 ? theme.colors.profit : s.dir === -1 ? theme.colors.loss : theme.colors.border }]}>
            <Text style={styles.sigLabel}>{s.label}</Text>
            <Text style={[styles.sigVal, { color: s.dir === 1 ? theme.colors.profit : s.dir === -1 ? theme.colors.loss : theme.colors.text }]}>
              {s.value}
            </Text>
          </View>
        ))}
      </View>

      {/* Candidates */}
      <Text style={styles.section}>
        {bias === 'NEUTRAL' ? 'Watchlist (wait for an edge before buying)' : `Buy candidates · ${live ? 'live chain' : 'sim chain'}`}
      </Text>
      {candidates.map(({ quote, strike, chgPct, tag }) => (
        <View key={quote.key} style={styles.candRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.candSym} numberOfLines={1}>
              {fmtNum(strike, 0)} {quote.type === 'CALL' ? 'CE' : 'PE'} <Text style={styles.candTag}>{tag}</Text>
            </Text>
            <Text style={styles.candMeta}>
              LTP {fmtNum(quote.ltp, 2)} · {chgPct >= 0 ? '+' : ''}
              {fmtNum(chgPct, 1)}% · OI {fmtNum(quote.oiLacs, 1)}L
            </Text>
          </View>
          <Text style={[styles.candChg, { color: chgPct >= 0 ? theme.colors.profit : theme.colors.loss }]}>
            {chgPct >= 0 ? '▲' : '▼'}
          </Text>
          <TouchableOpacity
            style={[styles.buyBtn, bias === 'NEUTRAL' && { backgroundColor: theme.colors.surfaceAlt }]}
            onPress={() => onTrade(quote, strike)}
          >
            <Text style={[styles.buyTxt, bias === 'NEUTRAL' && { color: theme.colors.textDim }]}>BUY</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text style={styles.disclaimer}>
        Signals are computed from live market data for paper-trading practice — not investment advice.
        Trend (2×) + RSI + VWAP + momentum must align before the scanner calls a side.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  verdict: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1.5, padding: 14 },
  verdictBias: { fontSize: 16, fontWeight: '800' },
  verdictSub: { color: theme.colors.textDim, fontSize: 11, marginTop: 5 },
  sigGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  sig: { flexBasis: '47%', flexGrow: 1, backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 10 },
  sigLabel: { color: theme.colors.textDim, fontSize: 10, marginBottom: 3 },
  sigVal: { fontSize: 14, fontWeight: '800' },
  section: { color: theme.colors.text, fontSize: 13, fontWeight: '800', marginTop: 16, marginBottom: 8 },
  candRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 11, marginBottom: 7 },
  candSym: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  candTag: { color: theme.colors.textFaint, fontSize: 10, fontWeight: '700' },
  candMeta: { color: theme.colors.textDim, fontSize: 11, marginTop: 3 },
  candChg: { fontSize: 14, fontWeight: '800' },
  buyBtn: { backgroundColor: theme.colors.buy, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  buyTxt: { color: '#0B0E11', fontSize: 13, fontWeight: '800' },
  disclaimer: { color: theme.colors.textFaint, fontSize: 10, lineHeight: 15, marginTop: 14 },
});
