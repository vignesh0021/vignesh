import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { niceStrikeStep } from '../constants/instruments';
import { getOptionChain } from '../services/brokers/fyers';
import { liveFeed } from '../services/liveFeed';
import { computeAnalytics, buildupLabel, type OptionAnalytics } from '../services/optionAnalytics';
import { buildChain, fyersChainToRows, type ChainRow } from '../services/optionChain';
import { theme } from '../theme';
import { fmtCompact, fmtNum } from '../utils/format';
import { fyersUnderlyingSymbol, upcomingExpiries } from '../utils/options';
import { useBrokerStore } from '../store/useBrokerStore';
import { usePortfolioStore } from '../store/usePortfolioStore';

/**
 * 📊 Option Analytics — openalgo-style tool set computed on-device from the live
 * chain: Max Pain, PCR, OI build-up, support/resistance, expected move, IV
 * smile, GEX and gamma density. Uses the real Fyers chain when connected,
 * otherwise a synthetic chain so the tools are always explorable.
 */
export function AnalyticsScreen() {
  const asset = usePortfolioStore((s) => s.asset);
  const spotPrice = usePortfolioStore((s) => s.spotPrice);
  const defaultIv = usePortfolioStore((s) => s.defaultIv);
  const rate = usePortfolioStore((s) => s.rate);
  const fyers = useBrokerStore((s) => s.fyers);
  const fyersReady = !!(fyers.appId && fyers.accessToken) && asset.assetClass === 'india_equity';

  const [rows, setRows] = useState<ChainRow[] | null>(null);
  const [expiryIso, setExpiryIso] = useState(upcomingExpiries(asset, 1)[0]);
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
          const chain = await getOptionChain(fyers.appId, fyers.accessToken!, fyersUnderlyingSymbol(asset), 15);
          if (cancelled) return;
          if (chain.rows.length) {
            const exp = chain.expiries[0]?.iso ?? expiryIso;
            setExpiryIso(exp);
            if (chain.underlyingLtp > 0) liveFeed.pushExternalSpot(chain.underlyingLtp);
            setRows(fyersChainToRows(chain, asset.symbol, exp, defaultIv, rate).rows);
            setSrc('live');
            return;
          }
        } catch {
          /* fall through */
        }
      }
      if (!cancelled) {
        const exp = upcomingExpiries(asset, 1)[0];
        setExpiryIso(exp);
        const built = buildChain({
          underlying: asset.symbol,
          spot: spot || spotPrice || 1,
          refSpot: spot || spotPrice || 1,
          iv: defaultIv,
          rate,
          expiryIso: exp,
          step,
          strikesEachSide: 12,
        });
        setRows(built.rows);
        setSrc('sim');
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fyersReady, fyers.appId, fyers.accessToken, asset.symbol]);

  const a = useMemo(
    () => (rows ? computeAnalytics(rows, spot || spotPrice, expiryIso, rate, asset.lotSize) : null),
    [rows, spot, spotPrice, expiryIso, rate, asset.lotSize],
  );

  if (!a) {
    return (
      <ScrollView contentContainerStyle={styles.emptyWrap}>
        <Text style={styles.emptyBig}>Loading option chain…</Text>
        <Text style={styles.emptySmall}>Analytics compute from the live chain (or a simulated one when offline).</Text>
      </ScrollView>
    );
  }

  const bias = a.pcrOI >= 1.2 ? 'Bullish' : a.pcrOI <= 0.7 ? 'Bearish' : 'Neutral';
  const biasColor = bias === 'Bullish' ? theme.colors.profit : bias === 'Bearish' ? theme.colors.loss : theme.colors.textDim;

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      <Text style={[styles.src, { color: src === 'live' ? theme.colors.profit : theme.colors.primary }]}>
        {src === 'live' ? `● Fyers LIVE · ${asset.symbol}` : `● SIM · ${asset.symbol}`} · spot {fmtNum(a.spot, 1)}
      </Text>

      {/* Summary tiles */}
      <View style={styles.grid}>
        <Tile label="Max Pain" value={fmtNum(a.maxPain, 0)} sub={`spot ${fmtNum(a.spot, 0)}`} />
        <Tile label="PCR (OI)" value={fmtNum(a.pcrOI, 2)} sub={bias} subColor={biasColor} />
        <Tile label="Support" value={fmtNum(a.support, 0)} sub="max put OI" subColor={theme.colors.profit} />
        <Tile label="Resistance" value={fmtNum(a.resistance, 0)} sub="max call OI" subColor={theme.colors.loss} />
        <Tile label="Exp. move" value={`±${fmtNum(a.expectedMove, 0)}`} sub={`${fmtNum(a.expectedMovePct, 2)}%`} />
        <Tile label="ATM IV" value={`${fmtNum(a.atmIV * 100, 1)}%`} sub="from LTP" />
        <Tile label="Net GEX" value={fmtCompact(a.netGEX)} sub={a.netGEX >= 0 ? 'pos · dampens' : 'neg · amplifies'} subColor={a.netGEX >= 0 ? theme.colors.profit : theme.colors.loss} />
        <Tile label="Gamma flip" value={a.gammaFlip != null ? fmtNum(a.gammaFlip, 0) : '—'} sub="zero-gamma" />
      </View>

      {/* OI profile */}
      <Text style={styles.section}>Open Interest by strike</Text>
      <Text style={styles.legend}>
        <Text style={{ color: theme.colors.loss }}>■ Call OI (resistance)</Text>   <Text style={{ color: theme.colors.profit }}>■ Put OI (support)</Text>
      </Text>
      <OIProfile a={a} />

      {/* IV smile */}
      <Text style={styles.section}>IV smile</Text>
      <IVSmile a={a} />

      {/* Gamma density */}
      <Text style={styles.section}>Gamma density (γ × OI)</Text>
      <GammaProfile a={a} />

      {/* OI build-up near ATM */}
      <Text style={styles.section}>OI build-up (near ATM)</Text>
      {a.rows
        .filter((r) => Math.abs(r.strike - a.atm) <= 5 * (a.rows[1] ? a.rows[1].strike - a.rows[0].strike : 50))
        .map((r) => (
          <View key={r.strike} style={[styles.buRow, r.atm && styles.buAtm]}>
            <Text style={styles.buStrike}>{fmtNum(r.strike, 0)}</Text>
            <Text style={[styles.buCell, { color: buColor(r.callBuildup) }]}>{buildupLabel(r.callBuildup)}</Text>
            <Text style={[styles.buCell, { color: buColor(r.putBuildup), textAlign: 'right' }]}>{buildupLabel(r.putBuildup)}</Text>
          </View>
        ))}

      <Text style={styles.disclaimer}>
        Max Pain, PCR, OI build-up, S/R, IV smile, expected move, GEX & gamma density — computed on-device
        from the chain (openalgo-style). {src === 'sim' ? 'OI-change build-up needs a live feed.' : ''} Not
        investment advice.
      </Text>
    </ScrollView>
  );
}

function OIProfile({ a }: { a: OptionAnalytics }) {
  const W = Dimensions.get('window').width - 24;
  const maxOI = Math.max(...a.rows.map((r) => Math.max(r.callOI, r.putOI)), 1);
  const barMax = W / 2 - 44;
  return (
    <View style={styles.card}>
      {a.rows.map((r) => (
        <View key={r.strike} style={styles.oiRow}>
          <View style={styles.oiCallSide}>
            <View style={[styles.oiBar, { width: (r.callOI / maxOI) * barMax, backgroundColor: theme.colors.loss + '99', alignSelf: 'flex-end' }]} />
          </View>
          <Text style={[styles.oiStrike, r.atm && { color: theme.colors.primary, fontWeight: '800' }, r.strike === a.maxPain && { textDecorationLine: 'underline' }]}>
            {fmtNum(r.strike, 0)}
          </Text>
          <View style={styles.oiPutSide}>
            <View style={[styles.oiBar, { width: (r.putOI / maxOI) * barMax, backgroundColor: theme.colors.profit + '99' }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function IVSmile({ a }: { a: OptionAnalytics }) {
  const W = Dimensions.get('window').width - 24;
  const H = 130;
  const pad = 24;
  const ivs = a.rows.flatMap((r) => [r.callIV, r.putIV]).filter((v) => v > 0.001 && v < 3);
  const lo = Math.min(...ivs, 0.05);
  const hi = Math.max(...ivs, 0.1);
  const x = (i: number) => pad + (i / Math.max(a.rows.length - 1, 1)) * (W - pad * 2);
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - 24);
  const callPts = a.rows.map((r, i) => `${x(i)},${y(r.callIV)}`).join(' ');
  const putPts = a.rows.map((r, i) => `${x(i)},${y(r.putIV)}`).join(' ');
  const atmIdx = a.rows.findIndex((r) => r.atm);
  return (
    <View style={styles.card}>
      <Svg width={W} height={H}>
        {[lo, (lo + hi) / 2, hi].map((v, k) => (
          <SvgText key={k} x={2} y={y(v) + 3} fill={theme.colors.textFaint} fontSize={9}>{(v * 100).toFixed(0)}%</SvgText>
        ))}
        {atmIdx >= 0 ? <Line x1={x(atmIdx)} x2={x(atmIdx)} y1={6} y2={H - 12} stroke={theme.colors.primary} strokeWidth={1} strokeDasharray="3 3" /> : null}
        <Polyline points={callPts} fill="none" stroke={theme.colors.loss} strokeWidth={1.4} />
        <Polyline points={putPts} fill="none" stroke={theme.colors.profit} strokeWidth={1.4} />
      </Svg>
      <Text style={styles.smileLegend}>
        <Text style={{ color: theme.colors.loss }}>— Call IV</Text>   <Text style={{ color: theme.colors.profit }}>— Put IV</Text>   · ATM {(a.atmIV * 100).toFixed(1)}%
      </Text>
    </View>
  );
}

function GammaProfile({ a }: { a: OptionAnalytics }) {
  const W = Dimensions.get('window').width - 24;
  const H = 120;
  const pad = 8;
  const maxG = Math.max(...a.rows.map((r) => r.gammaDensity), 1);
  const bw = Math.max(((W - pad * 2) / a.rows.length) * 0.6, 1);
  const x = (i: number) => pad + (i / Math.max(a.rows.length - 1, 1)) * (W - pad * 2);
  const flipIdx = a.gammaFlip != null ? a.rows.findIndex((r) => r.strike === a.gammaFlip) : -1;
  return (
    <View style={styles.card}>
      <Svg width={W} height={H}>
        {a.rows.map((r, i) => (
          <Rect key={r.strike} x={x(i) - bw / 2} y={H - 14 - (r.gammaDensity / maxG) * (H - 22)} width={bw} height={(r.gammaDensity / maxG) * (H - 22)} fill={r.atm ? theme.colors.primary : theme.colors.primary + '77'} />
        ))}
        {flipIdx >= 0 ? (
          <>
            <Line x1={x(flipIdx)} x2={x(flipIdx)} y1={4} y2={H - 12} stroke={theme.colors.text} strokeWidth={1} strokeDasharray="3 2" />
            <Circle cx={x(flipIdx)} cy={8} r={3} fill={theme.colors.text} />
          </>
        ) : null}
      </Svg>
      <Text style={styles.smileLegend}>Peak γ concentration pins price; the marked line is the gamma-flip strike.</Text>
    </View>
  );
}

function buColor(b: string): string {
  if (b === 'LONG_BUILDUP') return theme.colors.profit;
  if (b === 'SHORT_BUILDUP') return theme.colors.loss;
  if (b === 'SHORT_COVERING') return theme.colors.profit;
  if (b === 'LONG_UNWINDING') return theme.colors.loss;
  return theme.colors.textFaint;
}

function Tile({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileVal}>{value}</Text>
      {sub ? <Text style={[styles.tileSub, subColor ? { color: subColor } : null]}>{sub}</Text> : null}
      <View style={styles.tileUnderline} />
    </View>
  );
}

const styles = StyleSheet.create({
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyBig: { color: theme.colors.text, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  emptySmall: { color: theme.colors.textDim, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  src: { fontSize: 11, fontWeight: '800', marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexBasis: '47%', flexGrow: 1, backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 12 },
  tileLabel: { color: theme.colors.textFaint, fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  tileVal: { color: theme.colors.text, fontSize: 22, fontWeight: '800', marginTop: 4 },
  tileSub: { color: theme.colors.textDim, fontSize: 11, marginTop: 2 },
  tileUnderline: { height: 2, width: 26, backgroundColor: theme.colors.primary, borderRadius: 2, marginTop: 6 },
  section: { color: theme.colors.text, fontSize: 13, fontWeight: '800', marginTop: 18, marginBottom: 6 },
  legend: { fontSize: 10, marginBottom: 6 },
  card: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 8 },
  oiRow: { flexDirection: 'row', alignItems: 'center', height: 16, marginVertical: 1 },
  oiCallSide: { flex: 1, alignItems: 'flex-end' },
  oiPutSide: { flex: 1, alignItems: 'flex-start' },
  oiBar: { height: 9, borderRadius: 2 },
  oiStrike: { color: theme.colors.textDim, fontSize: 9, width: 44, textAlign: 'center' },
  smileLegend: { color: theme.colors.textFaint, fontSize: 10, marginTop: 4, paddingHorizontal: 4 },
  buRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  buAtm: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 6 },
  buStrike: { color: theme.colors.text, fontSize: 12, fontWeight: '700', width: 60, textAlign: 'center' },
  buCell: { flex: 1, fontSize: 11, fontWeight: '600' },
  disclaimer: { color: theme.colors.textFaint, fontSize: 10, lineHeight: 15, marginTop: 14 },
});
