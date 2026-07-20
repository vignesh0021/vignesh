import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { getHistory, type FyersCandle } from '../services/brokers/fyers';
import { liveFeed } from '../services/liveFeed';
import { theme } from '../theme';
import { fmtNum } from '../utils/format';
import {
  bollinger,
  ema,
  macd as macdCalc,
  rsi as rsiCalc,
  vwap as vwapCalc,
  type Series,
} from '../utils/indicators';
import { fyersUnderlyingSymbol } from '../utils/options';
import { useBrokerStore } from '../store/useBrokerStore';
import { usePortfolioStore } from '../store/usePortfolioStore';

/**
 * Live price-action chart for the underlying: real Fyers OHLC history when
 * connected (last candle updated tick-by-tick from the live feed), synthetic
 * candles otherwise so the chart works 24/7. Overlays (EMA 9/21, VWAP,
 * Bollinger) and sub-panels (RSI 14, MACD 12/26/9) are computed on-device.
 */

type TF = '1' | '5' | '15' | '60' | 'D';

const TFS: { key: TF; label: string; bucketSec: number; daysBack: number }[] = [
  { key: '1', label: '1m', bucketSec: 60, daysBack: 3 },
  { key: '5', label: '5m', bucketSec: 300, daysBack: 7 },
  { key: '15', label: '15m', bucketSec: 900, daysBack: 15 },
  { key: '60', label: '1H', bucketSec: 3600, daysBack: 45 },
  { key: 'D', label: '1D', bucketSec: 86400, daysBack: 270 },
];
const MAX_BARS = 80;

const COLOR = {
  ema9: theme.colors.primary,
  ema21: theme.colors.t0Line,
  vwap: '#C084FC',
  bb: '#5B6572',
};

/** Random-walk candles ending at the current spot — offline/demo tape. */
export function synthCandles(spot: number, bucketSec: number, iv: number, n = MAX_BARS): FyersCandle[] {
  const dtYears = bucketSec / (365 * 24 * 3600);
  const step = Math.max(iv, 0.05) * Math.sqrt(dtYears) * 2;
  const now = Math.floor(Date.now() / 1000);
  const t0 = Math.floor(now / bucketSec) * bucketSec - (n - 1) * bucketSec;
  const closes: number[] = new Array(n);
  closes[n - 1] = spot;
  for (let i = n - 2; i >= 0; i--) {
    closes[i] = closes[i + 1] * Math.exp((Math.random() * 2 - 1) * step);
  }
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    const h = Math.max(o, c) * (1 + Math.random() * step * 0.4);
    const l = Math.min(o, c) * (1 - Math.random() * step * 0.4);
    return { t: t0 + i * bucketSec, o, h, l, c, v: 0 };
  });
}

/** Polyline points string from the first defined value onward. */
function polyPoints(series: Series, x: (i: number) => number, y: (v: number) => number): string {
  const pts: string[] = [];
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v != null && isFinite(v)) pts.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  }
  return pts.join(' ');
}

interface Toggles {
  ema9: boolean;
  ema21: boolean;
  vwap: boolean;
  bb: boolean;
  rsi: boolean;
  macd: boolean;
}

export function PriceChart() {
  const asset = usePortfolioStore((s) => s.asset);
  const defaultIv = usePortfolioStore((s) => s.defaultIv);
  const fyers = useBrokerStore((s) => s.fyers);
  const fyersReady = !!(fyers.appId && fyers.accessToken) && asset.assetClass === 'india_equity';

  const [tf, setTf] = useState<TF>('5');
  const [candles, setCandles] = useState<FyersCandle[]>([]);
  const [src, setSrc] = useState<'live' | 'sim'>('sim');
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<Toggles>({ ema9: true, ema21: true, vwap: false, bb: false, rsi: false, macd: false });
  const [cross, setCross] = useState<number | null>(null);
  const synthKey = useRef('');

  const tfCfg = TFS.find((x) => x.key === tf)!;

  // History load: Fyers when connected, synthetic fallback. Refresh every 60s.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (fyersReady) {
        try {
          const to = new Date();
          const from = new Date(to.getTime() - tfCfg.daysBack * 864e5);
          const rows = await getHistory(
            fyers.appId,
            fyers.accessToken!,
            fyersUnderlyingSymbol(asset),
            tf,
            from.toISOString().slice(0, 10),
            to.toISOString().slice(0, 10),
          );
          if (!cancelled && rows.length > 0) {
            setCandles(rows.slice(-MAX_BARS));
            setSrc('live');
            setErr(null);
            synthKey.current = '';
            return;
          }
        } catch (e) {
          if (!cancelled) setErr((e as Error).message);
        }
      }
      if (!cancelled) {
        const key = `${tf}:${asset.symbol}`;
        if (synthKey.current !== key) {
          synthKey.current = key;
          const spot = liveFeed.getSpot() || usePortfolioStore.getState().spotPrice || 100;
          setCandles(synthCandles(spot, tfCfg.bucketSec, defaultIv));
        }
        setSrc('sim');
      }
    };
    setCross(null);
    load();
    const timer = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tf, asset.symbol, fyersReady, fyers.appId, fyers.accessToken]);

  // Tick-by-tick: update the forming candle, roll a new one on bucket change.
  useEffect(() => {
    const bucket = tfCfg.bucketSec;
    const unsub = liveFeed.subscribe((spot) => {
      if (!(spot > 0)) return;
      setCandles((prev) => {
        if (prev.length === 0) return prev;
        const curBucket = Math.floor(Math.floor(Date.now() / 1000) / bucket) * bucket;
        const last = prev[prev.length - 1];
        if (curBucket > last.t) {
          return [...prev.slice(-(MAX_BARS - 1)), { t: curBucket, o: spot, h: spot, l: spot, c: spot, v: 0 }];
        }
        if (spot === last.c) return prev;
        return [...prev.slice(0, -1), { ...last, c: spot, h: Math.max(last.h, spot), l: Math.min(last.l, spot) }];
      });
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tf]);

  // ---- indicators ---------------------------------------------------------
  const closes = useMemo(() => candles.map((c) => c.c), [candles]);
  const ema9 = useMemo(() => (show.ema9 ? ema(closes, 9) : null), [closes, show.ema9]);
  const ema21 = useMemo(() => (show.ema21 ? ema(closes, 21) : null), [closes, show.ema21]);
  const vw = useMemo(() => (show.vwap ? vwapCalc(candles) : null), [candles, show.vwap]);
  const bb = useMemo(() => (show.bb ? bollinger(closes) : null), [closes, show.bb]);
  const rs = useMemo(() => (show.rsi ? rsiCalc(closes) : null), [closes, show.rsi]);
  const mc = useMemo(() => (show.macd ? macdCalc(closes) : null), [closes, show.macd]);

  // ---- layout -------------------------------------------------------------
  const W = Dimensions.get('window').width;
  const H = 280;
  const PAD = { l: 6, r: 50, t: 10, b: 16 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const n = candles.length;

  const domain = useMemo(() => {
    if (n === 0) return { lo: 0, hi: 1 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    if (bb) {
      for (const v of bb.upper) if (v != null && v > hi) hi = v;
      for (const v of bb.lower) if (v != null && v < lo) lo = v;
    }
    const padY = (hi - lo) * 0.06 || 1;
    return { lo: lo - padY, hi: hi + padY };
  }, [candles, bb, n]);

  const x = (i: number) => PAD.l + ((i + 0.5) / Math.max(n, 1)) * plotW;
  const y = (v: number) => PAD.t + (1 - (v - domain.lo) / (domain.hi - domain.lo)) * plotH;
  const candleW = Math.max((plotW / Math.max(n, 1)) * 0.65, 1.5);

  const idxFromX = (px: number) => Math.min(n - 1, Math.max(0, Math.round(((px - PAD.l) / plotW) * n - 0.5)));

  const last = n > 0 ? candles[n - 1] : null;
  const first = n > 0 ? candles[0] : null;
  const sel = cross != null && candles[cross] ? candles[cross] : null;
  const shown = sel ?? last;
  const chg = shown && first ? shown.c - (sel ? shown.o : first.c) : 0;

  const fmtT = (t: number) => {
    const d = new Date(t * 1000);
    return tf === 'D'
      ? `${d.getDate()}/${d.getMonth() + 1}`
      : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const toggle = (k: keyof Toggles) => setShow((s) => ({ ...s, [k]: !s[k] }));

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Timeframes + source */}
      <View style={styles.tfRow}>
        {TFS.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tfChip, tf === t.key && styles.tfOn]} onPress={() => setTf(t.key)}>
            <Text style={[styles.tfTxt, tf === t.key && styles.tfTxtOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        <Text style={[styles.srcTxt, { color: src === 'live' ? theme.colors.profit : theme.colors.primary }]}>
          {src === 'live' ? '● Fyers' : '● SIM'}
        </Text>
      </View>

      {/* OHLC readout */}
      {shown ? (
        <View style={styles.ohlcRow}>
          <Text style={styles.ohlcTxt}>
            {sel ? fmtT(shown.t) + '  ' : ''}O <Text style={styles.ohlcVal}>{fmtNum(shown.o, 1)}</Text>  H{' '}
            <Text style={styles.ohlcVal}>{fmtNum(shown.h, 1)}</Text>  L <Text style={styles.ohlcVal}>{fmtNum(shown.l, 1)}</Text>  C{' '}
            <Text style={[styles.ohlcVal, { color: chg >= 0 ? theme.colors.profit : theme.colors.loss }]}>
              {fmtNum(shown.c, 1)}
            </Text>
          </Text>
          {sel ? (
            <TouchableOpacity onPress={() => setCross(null)} hitSlop={8}>
              <Text style={styles.clearX}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Price panel */}
      <View
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => setCross(idxFromX(e.nativeEvent.locationX))}
        onResponderMove={(e) => setCross(idxFromX(e.nativeEvent.locationX))}
      >
        <Svg width={W} height={H}>
          {/* y grid + labels */}
          {[0.25, 0.5, 0.75].map((f) => {
            const v = domain.lo + (domain.hi - domain.lo) * f;
            return (
              <React.Fragment key={f}>
                <Line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke={theme.colors.grid} strokeWidth={0.5} />
                <SvgText x={W - PAD.r + 4} y={y(v) + 3} fill={theme.colors.textFaint} fontSize={9}>
                  {fmtNum(v, v >= 1000 ? 0 : 1)}
                </SvgText>
              </React.Fragment>
            );
          })}

          {/* candles */}
          {candles.map((c, i) => {
            const up = c.c >= c.o;
            const col = up ? theme.colors.profit : theme.colors.loss;
            const bodyTop = y(Math.max(c.o, c.c));
            const bodyH = Math.max(Math.abs(y(c.o) - y(c.c)), 1);
            return (
              <React.Fragment key={c.t}>
                <Line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={1} />
                <Rect x={x(i) - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={col} />
              </React.Fragment>
            );
          })}

          {/* overlays */}
          {bb ? (
            <>
              <Polyline points={polyPoints(bb.upper, x, y)} fill="none" stroke={COLOR.bb} strokeWidth={1} strokeDasharray="3 3" />
              <Polyline points={polyPoints(bb.middle, x, y)} fill="none" stroke={COLOR.bb} strokeWidth={1} />
              <Polyline points={polyPoints(bb.lower, x, y)} fill="none" stroke={COLOR.bb} strokeWidth={1} strokeDasharray="3 3" />
            </>
          ) : null}
          {ema9 ? <Polyline points={polyPoints(ema9, x, y)} fill="none" stroke={COLOR.ema9} strokeWidth={1.4} /> : null}
          {ema21 ? <Polyline points={polyPoints(ema21, x, y)} fill="none" stroke={COLOR.ema21} strokeWidth={1.4} /> : null}
          {vw ? <Polyline points={polyPoints(vw, x, y)} fill="none" stroke={COLOR.vwap} strokeWidth={1.4} /> : null}

          {/* last price line */}
          {last ? (
            <>
              <Line x1={PAD.l} x2={W - PAD.r} y1={y(last.c)} y2={y(last.c)} stroke={theme.colors.crosshair} strokeWidth={0.6} strokeDasharray="2 3" />
              <SvgText x={W - PAD.r + 4} y={y(last.c) + 3} fill={theme.colors.text} fontSize={9} fontWeight="bold">
                {fmtNum(last.c, 1)}
              </SvgText>
            </>
          ) : null}

          {/* crosshair */}
          {cross != null && n > 0 ? (
            <Line x1={x(cross)} x2={x(cross)} y1={PAD.t} y2={H - PAD.b} stroke={theme.colors.crosshair} strokeWidth={0.8} strokeDasharray="3 2" />
          ) : null}

          {/* x labels */}
          {first && last ? (
            <>
              <SvgText x={PAD.l + 2} y={H - 4} fill={theme.colors.textFaint} fontSize={9}>{fmtT(first.t)}</SvgText>
              <SvgText x={W - PAD.r - 30} y={H - 4} fill={theme.colors.textFaint} fontSize={9}>{fmtT(last.t)}</SvgText>
            </>
          ) : null}
        </Svg>
      </View>

      {/* RSI panel */}
      {rs ? <RsiPanel series={rs} width={W} cross={cross} n={n} x={x} /> : null}
      {/* MACD panel */}
      {mc ? <MacdPanel macdR={mc} width={W} cross={cross} n={n} x={x} /> : null}

      {/* Indicator toggles */}
      <View style={styles.indRow}>
        {(
          [
            ['ema9', 'EMA 9', COLOR.ema9],
            ['ema21', 'EMA 21', COLOR.ema21],
            ['vwap', 'VWAP', COLOR.vwap],
            ['bb', 'BB 20', COLOR.bb],
            ['rsi', 'RSI 14', theme.colors.text],
            ['macd', 'MACD', theme.colors.text],
          ] as [keyof Toggles, string, string][]
        ).map(([k, label, col]) => (
          <TouchableOpacity key={k} style={[styles.indChip, show[k] && { borderColor: col }]} onPress={() => toggle(k)}>
            <Text style={[styles.indTxt, show[k] && { color: col === theme.colors.text ? theme.colors.text : col }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {err && src !== 'live' ? <Text style={styles.err}>⚠ Fyers history: {err} — showing simulated candles.</Text> : null}
      <Text style={styles.note}>
        {src === 'live'
          ? `Real ${asset.symbol} candles from Fyers · forming candle updates live`
          : 'Simulated candles (connect Fyers on an Indian index for real history)'}
      </Text>
    </ScrollView>
  );
}

function RsiPanel({ series, width, cross, n, x }: { series: Series; width: number; cross: number | null; n: number; x: (i: number) => number }) {
  const H = 70;
  const y = (v: number) => 6 + (1 - v / 100) * (H - 12);
  const lastV = [...series].reverse().find((v) => v != null) as number | undefined;
  const selV = cross != null ? series[cross] : null;
  return (
    <View style={styles.panel}>
      <Text style={styles.panelLabel}>
        RSI 14 · <Text style={{ color: theme.colors.primary }}>{fmtNum((selV ?? lastV ?? 0) as number, 1)}</Text>
      </Text>
      <Svg width={width} height={H}>
        {[30, 70].map((lvl) => (
          <Line key={lvl} x1={6} x2={width - 50} y1={y(lvl)} y2={y(lvl)} stroke={theme.colors.grid} strokeWidth={0.6} strokeDasharray="3 3" />
        ))}
        <Polyline points={polyPoints(series, x, y)} fill="none" stroke={theme.colors.primary} strokeWidth={1.3} />
        {cross != null && n > 0 ? <Line x1={x(cross)} x2={x(cross)} y1={4} y2={H - 4} stroke={theme.colors.crosshair} strokeWidth={0.7} strokeDasharray="3 2" /> : null}
      </Svg>
    </View>
  );
}

function MacdPanel({ macdR, width, cross, n, x }: { macdR: { macd: Series; signal: Series; histogram: Series }; width: number; cross: number | null; n: number; x: (i: number) => number }) {
  const H = 70;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of [macdR.macd, macdR.signal, macdR.histogram]) {
    for (const v of s) {
      if (v == null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!isFinite(lo) || !isFinite(hi) || lo === hi) {
    lo = -1;
    hi = 1;
  }
  const y = (v: number) => 6 + (1 - (v - lo) / (hi - lo)) * (H - 12);
  const barW = Math.max(((width - 56) / Math.max(n, 1)) * 0.5, 1);
  return (
    <View style={styles.panel}>
      <Text style={styles.panelLabel}>MACD 12·26·9</Text>
      <Svg width={width} height={H}>
        <Line x1={6} x2={width - 50} y1={y(0)} y2={y(0)} stroke={theme.colors.grid} strokeWidth={0.6} />
        {macdR.histogram.map((v, i) =>
          v != null ? (
            <Rect
              key={i}
              x={x(i) - barW / 2}
              y={Math.min(y(v), y(0))}
              width={barW}
              height={Math.max(Math.abs(y(v) - y(0)), 0.5)}
              fill={v >= 0 ? theme.colors.profit + '99' : theme.colors.loss + '99'}
            />
          ) : null,
        )}
        <Polyline points={polyPoints(macdR.macd, x, y)} fill="none" stroke={theme.colors.primary} strokeWidth={1.2} />
        <Polyline points={polyPoints(macdR.signal, x, y)} fill="none" stroke={theme.colors.t0Line} strokeWidth={1.2} />
        {cross != null && n > 0 ? <Line x1={x(cross)} x2={x(cross)} y1={4} y2={H - 4} stroke={theme.colors.crosshair} strokeWidth={0.7} strokeDasharray="3 2" /> : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  tfRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  tfChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  tfOn: { backgroundColor: theme.colors.primaryDim, borderColor: theme.colors.primary },
  tfTxt: { color: theme.colors.textDim, fontSize: 12, fontWeight: '700' },
  tfTxtOn: { color: theme.colors.text },
  srcTxt: { fontSize: 11, fontWeight: '800' },
  ohlcRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 2 },
  ohlcTxt: { color: theme.colors.textDim, fontSize: 11, flex: 1 },
  ohlcVal: { color: theme.colors.text, fontWeight: '700' },
  clearX: { color: theme.colors.textDim, fontSize: 13, fontWeight: '700', paddingHorizontal: 6 },
  panel: { borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 4 },
  panelLabel: { color: theme.colors.textDim, fontSize: 10, fontWeight: '700', paddingHorizontal: 12, paddingTop: 6 },
  indRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  indChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  indTxt: { color: theme.colors.textFaint, fontSize: 11, fontWeight: '700' },
  err: { color: theme.colors.loss, fontSize: 11, paddingHorizontal: 12, paddingTop: 8, lineHeight: 15 },
  note: { color: theme.colors.textFaint, fontSize: 10, paddingHorizontal: 12, paddingTop: 8 },
});
