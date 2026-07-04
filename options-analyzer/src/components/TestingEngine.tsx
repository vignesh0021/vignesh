import * as DocumentPicker from 'expo-document-picker';
import Papa from 'papaparse';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { bsPrice } from '../hooks/useBlackScholes';
import { theme } from '../theme';
import type { OptionPosition, OptionType } from '../types';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { fmtCompact, fmtNum } from '../utils/format';
import { closedOffset, legSign, legSize } from '../utils/payoff';

/**
 * Module 4 — Historical Backtesting & Forward-Testing core.
 *
 * Ingests an option-chain snapshot CSV via papaparse with columns:
 *   Timestamp, Spot Price, Strike, Call/Put, Bid, Ask, IV
 * and offers two modes:
 *   • Backtest Sandbox  — replays the whole timeline into a cumulative equity curve.
 *   • Forward Test       — steps tick-by-tick, feeding each snapshot into the live
 *                          Payoff graph / Greeks table via the shared store.
 */

interface ChainRow {
  ts: string;
  tsMs: number;
  spot: number;
  strike: number;
  type: OptionType;
  bid: number;
  ask: number;
  iv: number; // decimal
}

interface Snapshot {
  ts: string;
  tsMs: number;
  spot: number;
  rows: ChainRow[];
}

function parseType(v: string): OptionType {
  const s = (v || '').trim().toUpperCase();
  return s.startsWith('P') ? 'PUT' : 'CALL';
}

function parseIv(v: number): number {
  // Accept either 60 (percent) or 0.6 (decimal).
  if (!isFinite(v)) return 0.6;
  return v > 3 ? v / 100 : v;
}

function rowsToSnapshots(rows: ChainRow[]): Snapshot[] {
  const byTs = new Map<string, Snapshot>();
  for (const r of rows) {
    let snap = byTs.get(r.ts);
    if (!snap) {
      snap = { ts: r.ts, tsMs: r.tsMs, spot: r.spot, rows: [] };
      byTs.set(r.ts, snap);
    }
    snap.rows.push(r);
    if (isFinite(r.spot) && r.spot > 0) snap.spot = r.spot;
  }
  return [...byTs.values()].sort((a, b) => a.tsMs - b.tsMs);
}

/** Mark price of a leg at a snapshot: file mid if the strike/type is quoted, else BS. */
function markLeg(leg: OptionPosition, snap: Snapshot, rate: number): number {
  const match = snap.rows.find((r) => r.type === leg.type && Math.abs(r.strike - leg.strike) < 1e-6);
  if (match && (match.bid > 0 || match.ask > 0)) {
    return (match.bid + match.ask) / 2;
  }
  const days = Math.max((new Date(leg.expiry).getTime() - snap.tsMs) / 86400000, 0);
  const iv = match?.iv ?? leg.iv;
  return bsPrice({ spot: snap.spot, strike: leg.strike, timeYears: days / 365, rate, iv, type: leg.type });
}

export function TestingEngine() {
  const open = usePortfolioStore((s) => s.openPositions);
  const closed = usePortfolioStore((s) => s.closedPositions);
  const rate = usePortfolioStore((s) => s.rate);
  const setTargetSpot = usePortfolioStore((s) => s.setTargetSpot);
  const setTargetDate = usePortfolioStore((s) => s.setTargetDate);

  const [rows, setRows] = useState<ChainRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<'BACKTEST' | 'FORWARD'>('BACKTEST');
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const snapshots = useMemo(() => rowsToSnapshots(rows), [rows]);

  const ingest = (csv: string, name: string) => {
    const res = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    const parsed: ChainRow[] = [];
    for (const raw of res.data) {
      const get = (keys: string[]): string => {
        for (const k of Object.keys(raw)) {
          if (keys.some((want) => k.trim().toLowerCase() === want)) return raw[k];
        }
        return '';
      };
      const ts = get(['timestamp', 'time', 'date']);
      if (!ts) continue;
      parsed.push({
        ts,
        tsMs: new Date(ts).getTime() || 0,
        spot: Number(get(['spot price', 'spot', 'underlying'])),
        strike: Number(get(['strike'])),
        type: parseType(get(['call/put', 'type', 'option type', 'cp'])),
        bid: Number(get(['bid'])),
        ask: Number(get(['ask'])),
        iv: parseIv(Number(get(['iv', 'implied volatility']))),
      });
    }
    if (parsed.length === 0) {
      setError('No valid rows found. Expected columns: Timestamp, Spot Price, Strike, Call/Put, Bid, Ask, IV');
      return;
    }
    setError(null);
    setRows(parsed);
    setFileName(name);
    setStep(0);
  };

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', '*/*'] });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      const resp = await fetch(asset.uri);
      const text = await resp.text();
      ingest(text, asset.name ?? 'chain.csv');
    } catch (e) {
      setError(`Could not read file: ${String(e)}`);
    }
  };

  const loadSample = () => ingest(buildSampleCsv(open), 'sample-chain.csv');

  // ---- backtest equity curve -------------------------------------------
  const equity = useMemo(() => {
    if (snapshots.length === 0) return [] as { ts: string; pnl: number }[];
    const off = closedOffset(closed);
    return snapshots.map((snap) => {
      let pnl = off;
      for (const leg of open) {
        const mark = markLeg(leg, snap, rate);
        pnl += legSign(leg) * (mark - leg.entryPremium) * legSize(leg);
      }
      return { ts: snap.ts, pnl };
    });
  }, [snapshots, open, closed, rate]);

  const applyForwardStep = (idx: number) => {
    const snap = snapshots[idx];
    if (!snap) return;
    setStep(idx);
    setTargetSpot(snap.spot);
    setTargetDate(snap.ts.slice(0, 10));
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.ingestRow}>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={pickFile}>
          <Text style={styles.btnPrimaryTxt}>Upload CSV</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={loadSample}>
          <Text style={styles.btnOutlineTxt}>Load Sample</Text>
        </TouchableOpacity>
      </View>

      {fileName ? <Text style={styles.file}>Loaded: {fileName} · {rows.length} rows · {snapshots.length} snapshots</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {snapshots.length > 0 ? (
        <>
          <View style={styles.modeRow}>
            {(['BACKTEST', 'FORWARD'] as const).map((m) => (
              <TouchableOpacity key={m} style={[styles.modeBtn, mode === m && styles.modeBtnActive]} onPress={() => setMode(m)}>
                <Text style={[styles.modeTxt, mode === m && styles.modeTxtActive]}>
                  {m === 'BACKTEST' ? 'Backtest Sandbox' : 'Forward Test'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {mode === 'BACKTEST' ? (
            <EquityChart data={equity} />
          ) : (
            <ForwardControls
              snapshots={snapshots}
              step={step}
              onStep={applyForwardStep}
            />
          )}
        </>
      ) : (
        <Text style={styles.hint}>
          Upload a historical option-chain snapshot CSV (Timestamp, Spot Price, Strike, Call/Put, Bid, Ask, IV),
          or load the sample to replay your current portfolio through time.
        </Text>
      )}
    </ScrollView>
  );
}

function ForwardControls({
  snapshots,
  step,
  onStep,
}: {
  snapshots: Snapshot[];
  step: number;
  onStep: (i: number) => void;
}) {
  const snap = snapshots[step];
  return (
    <View style={styles.forwardCard}>
      <Text style={styles.forwardTitle}>Tick {step + 1} / {snapshots.length}</Text>
      <Text style={styles.forwardTs}>{snap?.ts}</Text>
      <View style={styles.forwardStat}>
        <Text style={styles.forwardLabel}>Spot</Text>
        <Text style={styles.forwardVal}>{fmtNum(snap?.spot ?? 0, 2)}</Text>
      </View>
      <Text style={styles.forwardHint}>
        Stepping feeds this snapshot's spot &amp; date into the live Payoff graph and Greeks table.
      </Text>
      <View style={styles.stepRow}>
        <TouchableOpacity style={[styles.stepBtn, step === 0 && styles.stepBtnDisabled]} disabled={step === 0} onPress={() => onStep(Math.max(step - 1, 0))}>
          <Text style={styles.stepTxt}>‹ Prev</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnOutline, { flex: 1 }]} onPress={() => onStep(0)}>
          <Text style={styles.btnOutlineTxt}>Reset</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.stepBtn, step >= snapshots.length - 1 && styles.stepBtnDisabled]}
          disabled={step >= snapshots.length - 1}
          onPress={() => onStep(Math.min(step + 1, snapshots.length - 1))}
        >
          <Text style={styles.stepTxt}>Next ›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function EquityChart({ data }: { data: { ts: string; pnl: number }[] }) {
  if (data.length < 2) return <Text style={styles.hint}>Need at least two snapshots to plot equity.</Text>;

  const W = 320;
  const H = 200;
  const pad = { l: 44, r: 12, t: 16, b: 22 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const ys = data.map((d) => d.pnl);
  const min = Math.min(...ys, 0);
  const max = Math.max(...ys, 0);
  const range = max - min || 1;

  const sx = (i: number) => pad.l + (i / (data.length - 1)) * plotW;
  const sy = (v: number) => pad.t + (1 - (v - min) / range) * plotH;

  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(d.pnl).toFixed(1)}`).join(' ');
  const last = data[data.length - 1].pnl;
  const zeroY = sy(0);

  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>Cumulative Equity</Text>
      <Svg width={W} height={H}>
        <Line x1={pad.l} y1={zeroY} x2={W - pad.r} y2={zeroY} stroke={theme.colors.border} strokeWidth={1} />
        {[0, 0.5, 1].map((f) => {
          const v = min + range * f;
          return (
            <SvgText key={f} x={pad.l - 6} y={sy(v) + 3} fill={theme.colors.textFaint} fontSize={9} textAnchor="end">
              {fmtCompact(v)}
            </SvgText>
          );
        })}
        <Path d={path} stroke={last >= 0 ? theme.colors.profit : theme.colors.loss} strokeWidth={2} fill="none" />
        <Circle cx={sx(data.length - 1)} cy={sy(last)} r={3.5} fill={last >= 0 ? theme.colors.profit : theme.colors.loss} />
      </Svg>
      <View style={styles.equityFooter}>
        <Text style={styles.equityLabel}>Final PNL</Text>
        <Text style={[styles.equityVal, { color: last >= 0 ? theme.colors.profit : theme.colors.loss }]}>
          {fmtNum(last, 2)} USD
        </Text>
      </View>
    </View>
  );
}

/** Synthesize a plausible chain so the module is demoable without a file. */
function buildSampleCsv(open: OptionPosition[]): string {
  const strikes = open.length ? [...new Set(open.map((p) => p.strike))] : [55000, 60000, 65000];
  const types: OptionType[] = ['CALL', 'PUT'];
  const lines = ['Timestamp,Spot Price,Strike,Call/Put,Bid,Ask,IV'];
  const start = Date.now() - 30 * 86400000;
  let spot = 62000;
  for (let d = 0; d < 30; d++) {
    const ts = new Date(start + d * 86400000).toISOString();
    spot = spot * (1 + (Math.sin(d / 3) * 0.02 + (Math.random() - 0.5) * 0.01));
    for (const k of strikes) {
      for (const t of types) {
        const days = 55 - d;
        const iv = 0.6;
        const mid = bsPrice({ spot, strike: k, timeYears: Math.max(days, 1) / 365, rate: 0.05, iv, type: t });
        const bid = Math.max(mid * 0.98, 0).toFixed(1);
        const ask = Math.max(mid * 1.02, 0).toFixed(1);
        lines.push(`${ts},${spot.toFixed(1)},${k},${t === 'CALL' ? 'Call' : 'Put'},${bid},${ask},${(iv * 100).toFixed(1)}`);
      }
    }
  }
  return lines.join('\n');
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.bg },
  ingestRow: { flexDirection: 'row', gap: 12, padding: 12 },
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center' },
  btnPrimary: { backgroundColor: theme.colors.primary, flex: 1 },
  btnPrimaryTxt: { color: '#0B0E11', fontWeight: '700', fontSize: 14 },
  btnOutline: { borderWidth: 1, borderColor: theme.colors.border, flex: 1 },
  btnOutlineTxt: { color: theme.colors.text, fontWeight: '600', fontSize: 14 },
  file: { color: theme.colors.textDim, fontSize: 12, marginHorizontal: 12, marginBottom: 4 },
  error: { color: theme.colors.loss, fontSize: 12, marginHorizontal: 12, marginVertical: 6 },
  hint: { color: theme.colors.textFaint, fontSize: 13, margin: 12, lineHeight: 19 },
  modeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, marginTop: 8, marginBottom: 4 },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: theme.colors.surface, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border },
  modeBtnActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '22' },
  modeTxt: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
  modeTxtActive: { color: theme.colors.primary },
  chartCard: { backgroundColor: theme.colors.surface, margin: 12, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border },
  chartTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '600', alignSelf: 'flex-start', marginBottom: 8 },
  equityFooter: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 8 },
  equityLabel: { color: theme.colors.textDim, fontSize: 13 },
  equityVal: { fontSize: 15, fontWeight: '700' },
  forwardCard: { backgroundColor: theme.colors.surface, margin: 12, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: theme.colors.border },
  forwardTitle: { color: theme.colors.primary, fontSize: 16, fontWeight: '700' },
  forwardTs: { color: theme.colors.textDim, fontSize: 13, marginTop: 4 },
  forwardStat: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  forwardLabel: { color: theme.colors.textDim, fontSize: 14 },
  forwardVal: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  forwardHint: { color: theme.colors.textFaint, fontSize: 12, marginTop: 12, lineHeight: 18 },
  stepRow: { flexDirection: 'row', gap: 8, marginTop: 16, alignItems: 'center' },
  stepBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, backgroundColor: theme.colors.primary },
  stepBtnDisabled: { opacity: 0.35 },
  stepTxt: { color: '#0B0E11', fontWeight: '700', fontSize: 14 },
});
