import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  PanGestureHandler,
  State,
  type HandlerStateChangeEvent,
  type PanGestureHandlerEventPayload,
  type PanGestureHandlerGestureEvent,
} from 'react-native-gesture-handler';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import { theme } from '../theme';
import type { CurveParams, PayoffSample } from '../utils/payoff';
import { buildPayoffCurve } from '../utils/payoff';
import { fmtCompact, fmtNum } from '../utils/format';

interface Props {
  width: number;
  height: number;
  params: CurveParams;
  spot: number;
  targetSpot: number;
  strikes: number[];
  breakevens: number[];
}

const PAD = { left: 46, right: 16, top: 22, bottom: 26 };

function PayoffChartBase({
  width,
  height,
  params,
  spot,
  targetSpot,
  strikes,
  breakevens,
}: Props) {
  const [touchX, setTouchX] = useState<number | null>(null);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  // ---- domain -----------------------------------------------------------
  const domain = useMemo(() => {
    const refs = [spot, targetSpot, ...strikes].filter((v) => isFinite(v) && v > 0);
    const lo = Math.min(...refs) * 0.82;
    const hi = Math.max(...refs) * 1.18;
    return { lo, hi };
  }, [spot, targetSpot, strikes]);

  const samples: PayoffSample[] = useMemo(
    () => buildPayoffCurve(params, domain.lo, domain.hi, 140),
    [params, domain.lo, domain.hi],
  );

  const yRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const s of samples) {
      min = Math.min(min, s.expiry, s.value);
      max = Math.max(max, s.expiry, s.value);
    }
    if (!isFinite(min)) {
      min = -1;
      max = 1;
    }
    const pad = (max - min) * 0.12 || 1;
    return { min: min - pad, max: max + pad };
  }, [samples]);

  // ---- scales -----------------------------------------------------------
  const sx = (price: number) =>
    PAD.left + ((price - domain.lo) / (domain.hi - domain.lo)) * plotW;
  const sy = (pnl: number) =>
    PAD.top + (1 - (pnl - yRange.min) / (yRange.max - yRange.min)) * plotH;

  const zeroY = sy(0);

  const toPath = (key: 'expiry' | 'value') =>
    samples
      .map((s, i) => `${i === 0 ? 'M' : 'L'}${sx(s.spot).toFixed(1)},${sy(s[key]).toFixed(1)}`)
      .join(' ');

  const expiryPath = useMemo(() => toPath('expiry'), [samples]);
  const valuePath = useMemo(() => toPath('value'), [samples]);

  // Filled area under the expiry curve, later split green/red by clip rects.
  const areaPath = useMemo(() => {
    const first = samples[0];
    const last = samples[samples.length - 1];
    return (
      `M${sx(first.spot).toFixed(1)},${zeroY.toFixed(1)} ` +
      samples.map((s) => `L${sx(s.spot).toFixed(1)},${sy(s.expiry).toFixed(1)}`).join(' ') +
      ` L${sx(last.spot).toFixed(1)},${zeroY.toFixed(1)} Z`
    );
  }, [samples, zeroY]);

  // ---- crosshair --------------------------------------------------------
  const clampedTouch =
    touchX == null ? null : Math.max(PAD.left, Math.min(width - PAD.right, touchX));
  const touchPrice =
    clampedTouch == null
      ? null
      : domain.lo + ((clampedTouch - PAD.left) / plotW) * (domain.hi - domain.lo);

  const nearest = useMemo(() => {
    if (touchPrice == null) return null;
    let best = samples[0];
    let bestD = Infinity;
    for (const s of samples) {
      const d = Math.abs(s.spot - touchPrice);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }, [touchPrice, samples]);

  const onGesture = (e: PanGestureHandlerGestureEvent) => {
    setTouchX(e.nativeEvent.x);
  };

  const onStateChange = (e: HandlerStateChangeEvent<PanGestureHandlerEventPayload>) => {
    const { state } = e.nativeEvent;
    if (state === State.BEGAN || state === State.ACTIVE) {
      setTouchX(e.nativeEvent.x);
    } else if (state === State.END || state === State.CANCELLED || state === State.FAILED) {
      setTouchX(null);
    }
  };

  // ---- axis ticks -------------------------------------------------------
  const xTicks = 5;
  const yTicks = 4;

  return (
    <View style={{ width, height }}>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDash, { backgroundColor: theme.colors.t0Line }]} />
          <Text style={styles.legendText}>T+0 (now)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDash, { backgroundColor: theme.colors.expiryLine }]} />
          <Text style={styles.legendText}>On Expiry</Text>
        </View>
      </View>

      <PanGestureHandler onGestureEvent={onGesture} onHandlerStateChange={onStateChange}>
        <View>
          <Svg width={width} height={height}>
            <Defs>
              <ClipPath id="area">
                <Path d={areaPath} />
              </ClipPath>
            </Defs>

            {/* profit / loss shading via clipped colour rects */}
            <Rect
              x={PAD.left}
              y={PAD.top}
              width={plotW}
              height={Math.max(zeroY - PAD.top, 0)}
              fill={theme.colors.profit}
              opacity={0.16}
              clipPath="url(#area)"
            />
            <Rect
              x={PAD.left}
              y={zeroY}
              width={plotW}
              height={Math.max(PAD.top + plotH - zeroY, 0)}
              fill={theme.colors.loss}
              opacity={0.16}
              clipPath="url(#area)"
            />

            {/* grid + y ticks */}
            {Array.from({ length: yTicks + 1 }).map((_, i) => {
              const v = yRange.min + ((yRange.max - yRange.min) * i) / yTicks;
              const y = sy(v);
              return (
                <React.Fragment key={`y${i}`}>
                  <Line x1={PAD.left} y1={y} x2={width - PAD.right} y2={y} stroke={theme.colors.grid} strokeWidth={0.5} />
                  <SvgText x={PAD.left - 6} y={y + 3} fill={theme.colors.textFaint} fontSize={9} textAnchor="end">
                    {fmtCompact(v)}
                  </SvgText>
                </React.Fragment>
              );
            })}

            {/* x ticks */}
            {Array.from({ length: xTicks + 1 }).map((_, i) => {
              const p = domain.lo + ((domain.hi - domain.lo) * i) / xTicks;
              const x = sx(p);
              return (
                <SvgText key={`x${i}`} x={x} y={height - 8} fill={theme.colors.textFaint} fontSize={9} textAnchor="middle">
                  {fmtCompact(p)}
                </SvgText>
              );
            })}

            {/* zero line */}
            <Line x1={PAD.left} y1={zeroY} x2={width - PAD.right} y2={zeroY} stroke={theme.colors.border} strokeWidth={1} />

            {/* breakevens */}
            {breakevens.map((b, i) => (
              <Line
                key={`be${i}`}
                x1={sx(b)}
                y1={PAD.top}
                x2={sx(b)}
                y2={PAD.top + plotH}
                stroke={theme.colors.textFaint}
                strokeWidth={0.75}
                strokeDasharray="3 3"
              />
            ))}

            {/* current price marker */}
            <Line x1={sx(spot)} y1={PAD.top} x2={sx(spot)} y2={PAD.top + plotH} stroke={theme.colors.t0Line} strokeWidth={1} opacity={0.7} />

            {/* payoff curves */}
            <Path d={expiryPath} stroke={theme.colors.expiryLine} strokeWidth={2} fill="none" />
            <Path d={valuePath} stroke={theme.colors.t0Line} strokeWidth={2} fill="none" />

            {/* crosshair */}
            {clampedTouch != null && nearest != null && (
              <>
                <Line x1={clampedTouch} y1={PAD.top} x2={clampedTouch} y2={PAD.top + plotH} stroke={theme.colors.crosshair} strokeWidth={0.75} opacity={0.6} />
                <Circle cx={sx(nearest.spot)} cy={sy(nearest.expiry)} r={3.5} fill={theme.colors.expiryLine} />
                <Circle cx={sx(nearest.spot)} cy={sy(nearest.value)} r={3.5} fill={theme.colors.t0Line} />
              </>
            )}
          </Svg>

          {/* tooltip */}
          {nearest != null && (
            <View style={[styles.tooltip, { left: Math.min(Math.max((clampedTouch ?? 0) - 70, 4), width - 144) }]}>
              <Text style={styles.tipSpot}>Spot {fmtNum(nearest.spot, 0)}</Text>
              <Text style={[styles.tipVal, { color: theme.colors.t0Line }]}>T+0: {fmtNum(nearest.value, 2)}</Text>
              <Text style={[styles.tipVal, { color: theme.colors.expiryLine }]}>Exp: {fmtNum(nearest.expiry, 2)}</Text>
            </View>
          )}
        </View>
      </PanGestureHandler>
    </View>
  );
}

const styles = StyleSheet.create({
  legendRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: PAD.left, marginBottom: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDash: { width: 14, height: 3, borderRadius: 2 },
  legendText: { color: theme.colors.textDim, fontSize: 11 },
  tooltip: {
    position: 'absolute',
    top: 30,
    width: 140,
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tipSpot: { color: theme.colors.text, fontSize: 12, fontWeight: '600', marginBottom: 2 },
  tipVal: { fontSize: 12, fontWeight: '600' },
});

export const PayoffChart = React.memo(PayoffChartBase);
