import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { niceStrikeStep } from '../constants/instruments';
import { getOptionChain } from '../services/brokers/fyers';
import { liveFeed } from '../services/liveFeed';
import { buildChain, fyersChainToRows } from '../services/optionChain';
import { computeFuturesArb, computeVolSurface, type ExpirySlice } from '../services/volArb';
import { theme } from '../theme';
import { daysBetween, fmtNum, todayIso } from '../utils/format';
import { expiryTag, fyersUnderlyingSymbol, upcomingExpiries } from '../utils/options';
import { useBrokerStore } from '../store/useBrokerStore';
import { usePortfolioStore } from '../store/usePortfolioStore';

/**
 * 📐 Vol Surface + Futures Arb — the multi-expiry analytics tools. Fetches the
 * chain for the nearest ~4 expiries (real Fyers when connected, synthetic
 * otherwise), then renders the ATM-IV term structure, an IV surface heatmap
 * over moneyness × expiry, and a put-call-parity synthetic-future arbitrage
 * table (implied forward vs fair forward, basis, carry, rich/cheap signal).
 */
const N_EXP = 4;

export function VolArbScreen() {
  const asset = usePortfolioStore((s) => s.asset);
  const spotPrice = usePortfolioStore((s) => s.spotPrice);
  const defaultIv = usePortfolioStore((s) => s.defaultIv);
  const rate = usePortfolioStore((s) => s.rate);
  const fyers = useBrokerStore((s) => s.fyers);
  const fyersReady = !!(fyers.appId && fyers.accessToken) && asset.assetClass === 'india_equity';

  const [slices, setSlices] = useState<ExpirySlice[]>([]);
  const [spot, setSpot] = useState(spotPrice > 0 ? spotPrice : 0);
  const [src, setSrc] = useState<'live' | 'sim'>('sim');

  useEffect(() => {
    const unsub = liveFeed.subscribe((s) => s > 0 && setSpot(s));
    liveFeed.setBase(spotPrice, Math.min(Math.max(defaultIv, 0.05), 1.5));
    liveFeed.start();
    return () => {
      unsub();
      liveFeed.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const step = asset.strikeStep > 0 ? asset.strikeStep : niceStrikeStep(spot || spotPrice || 1);
    const load = async () => {
      if (fyersReady) {
        try {
          const symbol = fyersUnderlyingSymbol(asset);
          const first = await getOptionChain(fyers.appId, fyers.accessToken!, symbol, 12);
          if (cancelled) return;
          const exps = first.expiries.slice(0, N_EXP);
          const out: ExpirySlice[] = [];
          for (const e of exps) {
            const ch = e.iso === exps[0].iso ? first : await getOptionChain(fyers.appId, fyers.accessToken!, symbol, 12, e.epoch);
            if (cancelled) return;
            out.push({ iso: e.iso, rows: fyersChainToRows(ch, asset.symbol, e.iso, defaultIv, rate).rows });
          }
          if (first.underlyingLtp > 0) liveFeed.pushExternalSpot(first.underlyingLtp);
          setSlices(out);
          setSrc('live');
          return;
        } catch {
          /* fall through */
        }
      }
      if (!cancelled) {
        const base = spot || spotPrice || 1;
        const exps = upcomingExpiries(asset, N_EXP);
        setSlices(
          exps.map((iso, i) => ({
            iso,
            // Mild term structure so the synthetic surface isn't flat.
            rows: buildChain({
              underlying: asset.symbol,
              spot: base,
              refSpot: base,
              iv: defaultIv * (1 + 0.04 * i),
              rate,
              expiryIso: iso,
              step,
              strikesEachSide: 6,
            }).rows,
          })),
        );
        setSrc('sim');
      }
    };
    load();
    const t = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fyersReady, fyers.appId, fyers.accessToken, asset.symbol]);

  const s = spot || spotPrice;
  const surface = useMemo(() => (slices.length ? computeVolSurface(slices, s, rate) : null), [slices, s, rate]);
  const arb = useMemo(() => (slices.length ? computeFuturesArb(slices, s, rate) : null), [slices, s, rate]);

  if (!surface || surface.expiries.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.emptyWrap}>
        <Text style={styles.emptyBig}>Loading multi-expiry chains…</Text>
        <Text style={styles.emptySmall}>Vol surface & futures arb need several expiries — connect Fyers for live data.</Text>
      </ScrollView>
    );
  }

  const W = Dimensions.get('window').width - 24;

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      <Text style={[styles.src, { color: src === 'live' ? theme.colors.profit : theme.colors.primary }]}>
        {src === 'live' ? `● Fyers LIVE · ${asset.symbol}` : `● SIM · ${asset.symbol}`} · spot {fmtNum(s, 1)} · {surface.expiries.length} expiries
      </Text>

      {/* Term structure */}
      <Text style={styles.section}>ATM IV term structure</Text>
      <TermStructure surface={surface} width={W} />

      {/* Surface heatmap */}
      <Text style={styles.section}>Vol surface (IV by moneyness × expiry)</Text>
      <View style={styles.card}>
        <View style={styles.hmHeadRow}>
          <Text style={[styles.hmCorner]}>DTE ⟍ off</Text>
          {surface.offsets.map((o) => (
            <Text key={o} style={styles.hmColLabel}>
              {o > 0 ? `+${o}` : o}
            </Text>
          ))}
        </View>
        {surface.expiries.map((e) => (
          <View key={e.iso} style={styles.hmRow}>
            <Text style={styles.hmRowLabel}>{Math.round(e.dte)}d</Text>
            {e.cells.map((c) => {
              const t = (c.iv - surface.ivLo) / (surface.ivHi - surface.ivLo || 1);
              return (
                <View key={c.offset} style={[styles.hmCell, { backgroundColor: `rgba(255,31,61,${(0.12 + 0.72 * Math.max(0, Math.min(1, t))).toFixed(2)})` }]}>
                  <Text style={styles.hmCellTxt}>{(c.iv * 100).toFixed(0)}</Text>
                </View>
              );
            })}
          </View>
        ))}
        <Text style={styles.hmNote}>Cells = IV%; brighter red = higher IV. Column 0 = ATM. {src === 'sim' ? 'Sim smile is flat; term varies.' : ''}</Text>
      </View>

      {/* Futures arb */}
      <Text style={styles.section}>Synthetic futures arbitrage (put-call parity)</Text>
      <View style={styles.card}>
        <View style={styles.arbHead}>
          <Text style={[styles.arbH, { flex: 0.7 }]}>DTE</Text>
          <Text style={[styles.arbH, { flex: 1.3 }]}>Impl Fwd</Text>
          <Text style={[styles.arbH, { flex: 1.3 }]}>Fair Fwd</Text>
          <Text style={[styles.arbH, { flex: 1 }]}>Basis%</Text>
          <Text style={[styles.arbH, { flex: 1 }]}>Carry%</Text>
          <Text style={[styles.arbH, { flex: 1 }]}>Signal</Text>
        </View>
        {arb!.map((r) => {
          const col = r.signal === 'RICH' ? theme.colors.loss : r.signal === 'CHEAP' ? theme.colors.profit : theme.colors.textDim;
          return (
            <View key={r.iso} style={styles.arbRow}>
              <Text style={[styles.arbCell, { flex: 0.7 }]}>{Math.round(r.dte)}d</Text>
              <Text style={[styles.arbCell, { flex: 1.3 }]}>{fmtNum(r.impliedForward, 1)}</Text>
              <Text style={[styles.arbCell, { flex: 1.3 }]}>{fmtNum(r.fairForward, 1)}</Text>
              <Text style={[styles.arbCell, { flex: 1, color: r.basisPct >= 0 ? theme.colors.profit : theme.colors.loss }]}>
                {r.basisPct >= 0 ? '+' : ''}{fmtNum(r.basisPct, 2)}
              </Text>
              <Text style={[styles.arbCell, { flex: 1 }]}>{fmtNum(r.carryAnnPct, 1)}</Text>
              <Text style={[styles.arbCell, { flex: 1, color: col, fontWeight: '800' }]}>{r.signal}</Text>
            </View>
          );
        })}
        <Text style={styles.hmNote}>
          RICH = synthetic future above fair (sell synthetic / buy basket); CHEAP = below fair (reverse). Fair = spot·e^(rT).
        </Text>
      </View>

      <Text style={styles.disclaimer}>
        Multi-expiry IV surface + put-call-parity synthetic-future arb, computed on-device. Real skew needs
        the live Fyers chain. Not investment advice.
      </Text>
    </ScrollView>
  );
}

function TermStructure({ surface, width }: { surface: NonNullable<ReturnType<typeof computeVolSurface>>; width: number }) {
  const H = 120;
  const pad = 28;
  const ex = surface.expiries;
  const ivs = ex.map((e) => e.atmIV);
  const lo = Math.min(...ivs) * 0.98;
  const hi = Math.max(...ivs) * 1.02;
  const x = (i: number) => pad + (i / Math.max(ex.length - 1, 1)) * (width - pad * 2);
  const y = (v: number) => 10 + (1 - (v - lo) / (hi - lo || 1)) * (H - 30);
  const pts = ex.map((e, i) => `${x(i)},${y(e.atmIV)}`).join(' ');
  return (
    <View style={styles.card}>
      <Svg width={width} height={H}>
        <Polyline points={pts} fill="none" stroke={theme.colors.primary} strokeWidth={1.6} />
        {ex.map((e, i) => (
          <React.Fragment key={e.iso}>
            <Circle cx={x(i)} cy={y(e.atmIV)} r={3} fill={theme.colors.primary} />
            <SvgText x={x(i)} y={y(e.atmIV) - 7} fill={theme.colors.text} fontSize={9} textAnchor="middle">
              {(e.atmIV * 100).toFixed(1)}
            </SvgText>
            <SvgText x={x(i)} y={H - 4} fill={theme.colors.textFaint} fontSize={9} textAnchor="middle">
              {expiryTag(e.iso)}
            </SvgText>
          </React.Fragment>
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyBig: { color: theme.colors.text, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  emptySmall: { color: theme.colors.textDim, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  src: { fontSize: 11, fontWeight: '800', marginBottom: 10 },
  section: { color: theme.colors.text, fontSize: 13, fontWeight: '800', marginTop: 16, marginBottom: 6 },
  card: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 8 },
  hmHeadRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  hmCorner: { color: theme.colors.textFaint, fontSize: 8, width: 40 },
  hmColLabel: { flex: 1, color: theme.colors.textDim, fontSize: 9, textAlign: 'center', fontWeight: '700' },
  hmRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 1 },
  hmRowLabel: { color: theme.colors.textDim, fontSize: 10, width: 40, fontWeight: '700' },
  hmCell: { flex: 1, marginHorizontal: 1, borderRadius: 3, paddingVertical: 6, alignItems: 'center' },
  hmCellTxt: { color: '#fff', fontSize: 10, fontWeight: '700' },
  hmNote: { color: theme.colors.textFaint, fontSize: 9, marginTop: 6, lineHeight: 13 },
  arbHead: { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  arbH: { color: theme.colors.textFaint, fontSize: 9, fontWeight: '700', textAlign: 'center' },
  arbRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  arbCell: { color: theme.colors.text, fontSize: 11, textAlign: 'center' },
  disclaimer: { color: theme.colors.textFaint, fontSize: 10, lineHeight: 15, marginTop: 14 },
});
