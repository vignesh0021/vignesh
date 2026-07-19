import React, { useMemo, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { theme } from '../theme';
import { fmtNum, todayIso } from '../utils/format';
import { computeRisk, type CurveParams } from '../utils/payoff';
import {
  usePaperStore,
  paperToOptionPositions,
  positionPnl,
  type PaperOrder,
  type PaperPosition,
} from '../store/usePaperStore';
import { PayoffChart } from './PayoffChart';

/** Live paper positions with mark-to-market P&L and one-tap square-off. */
export function PaperPositions({ currency, spot, rate }: { currency: string; spot: number; rate: number }) {
  const positions = usePaperStore((s) => s.positions);
  const squareOffAll = usePaperStore((s) => s.squareOffAll);

  if (positions.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.emptyWrap}>
        <Text style={styles.emptyBig}>No open paper positions</Text>
        <Text style={styles.emptySmall}>Open the Chain tab and tap a strike to place your first paper trade.</Text>
      </ScrollView>
    );
  }

  const totalPnl = positions.reduce((a, p) => a + positionPnl(p), 0);

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      <LivePayoff positions={positions} spot={spot} rate={rate} currency={currency} />
      <View style={styles.topRow}>
        <Text style={styles.count}>{positions.length} open</Text>
        <TouchableOpacity style={styles.sqAll} onPress={squareOffAll}>
          <Text style={styles.sqAllTxt}>Square off all</Text>
        </TouchableOpacity>
      </View>
      {positions.map((p) => (
        <PositionCard key={p.id} pos={p} currency={currency} />
      ))}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Open MTM</Text>
        <Text style={[styles.totalVal, { color: totalPnl >= 0 ? theme.colors.profit : theme.colors.loss }]}>
          {totalPnl >= 0 ? '+' : ''}
          {fmtNum(totalPnl, 2)} {currency}
        </Text>
      </View>
    </ScrollView>
  );
}

/** Live payoff diagram that redraws every tick as paper positions are taken. */
function LivePayoff({
  positions,
  spot,
  rate,
  currency,
}: {
  positions: PaperPosition[];
  spot: number;
  rate: number;
  currency: string;
}) {
  const legs = useMemo(() => paperToOptionPositions(positions), [positions]);
  const params: CurveParams = useMemo(
    () => ({ open: legs, closed: [], rate, ivShift: 0, evalDateIso: todayIso() }),
    [legs, rate],
  );
  const risk = useMemo(() => computeRisk(params, spot), [params, spot]);
  const strikes = useMemo(() => legs.map((l) => l.strike), [legs]);
  const width = Dimensions.get('window').width - 24;

  if (spot <= 0) return null;
  return (
    <View style={styles.payoffCard}>
      <View style={styles.payoffHead}>
        <Text style={styles.payoffTitle}>Live Payoff</Text>
        <Text style={styles.payoffMeta}>
          Max P {risk.maxProfitUnbounded ? '∞' : fmtNum(risk.maxProfit, 0)} · Max L{' '}
          {risk.maxLossUnbounded ? '∞' : fmtNum(Math.abs(risk.maxLoss), 0)} {currency}
        </Text>
      </View>
      <PayoffChart
        width={width}
        height={210}
        params={params}
        spot={spot}
        targetSpot={spot}
        strikes={strikes}
        breakevens={risk.breakevens}
      />
    </View>
  );
}

function PositionCard({ pos, currency }: { pos: PaperPosition; currency: string }) {
  const setSlTarget = usePaperStore((s) => s.setSlTarget);
  const squareOff = usePaperStore((s) => s.squareOff);
  const placeOrder = usePaperStore((s) => s.placeOrder);

  const [panel, setPanel] = useState<'none' | 'exit' | 'sl'>('none');
  const [slDraft, setSlDraft] = useState('');
  const [tgtDraft, setTgtDraft] = useState('');
  const [trailDraft, setTrailDraft] = useState('');
  const [exitLots, setExitLots] = useState(1);
  const [exitLimit, setExitLimit] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  const pnl = positionPnl(pos);
  const isBuy = pos.action === 'BUY';
  const color = isBuy ? theme.colors.buy : theme.colors.sell;

  const openSl = () => {
    setSlDraft(pos.sl != null ? fmtNum(pos.sl, 2).replace(/,/g, '') : '');
    setTgtDraft(pos.target != null ? fmtNum(pos.target, 2).replace(/,/g, '') : '');
    setTrailDraft(pos.trailSl != null ? String(pos.trailSl) : '');
    setPanel('sl');
  };
  const saveSl = () => {
    const sl = Number(slDraft);
    const tgt = Number(tgtDraft);
    const trail = Number(trailDraft);
    setSlTarget(pos.id, sl > 0 ? sl : undefined, tgt > 0 ? tgt : undefined, trail > 0 ? trail : undefined);
    setPanel('none');
  };
  const openExit = () => {
    setExitLots(pos.lots);
    setExitLimit('');
    setFlash(null);
    setPanel('exit');
  };
  const doExit = () => {
    const limit = Number(exitLimit);
    if (exitLimit.trim() && limit > 0) {
      // Exit at a limit price: rests as an opposite-side LIMIT order.
      const res = placeOrder(
        {
          key: pos.key,
          symbol: pos.symbol,
          underlying: pos.underlying,
          strike: pos.strike,
          optType: pos.optType,
          expiryIso: pos.expiryIso,
          lotSize: pos.lotSize,
          iv: pos.iv,
          rate: pos.rate,
          action: isBuy ? 'SELL' : 'BUY',
          orderType: 'LIMIT',
          product: pos.product,
          lots: exitLots,
          limitPrice: limit,
        },
        pos.ltp,
      );
      if (!res.ok) {
        setFlash(res.reason ?? 'Order rejected');
        return;
      }
    } else {
      squareOff(pos.id, exitLots);
    }
    setPanel('none');
  };

  const slBadge =
    pos.trailSl != null
      ? `TSL ${fmtNum(pos.trailSl, 1)}${pos.sl != null ? ` @${fmtNum(pos.sl, 1)}` : ''}`
      : pos.sl != null || pos.target != null
        ? `SL ${pos.sl != null ? fmtNum(pos.sl, 1) : '—'} · T ${pos.target != null ? fmtNum(pos.target, 1) : '—'}`
        : '+ SL / Target';

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.actBadge, { backgroundColor: color + '22' }]}>
          <Text style={[styles.actTxt, { color }]}>{pos.action}</Text>
        </View>
        <Text style={styles.sym} numberOfLines={1}>
          {pos.symbol}
        </Text>
        <Text style={[styles.pnl, { color: pnl >= 0 ? theme.colors.profit : theme.colors.loss }]}>
          {pnl >= 0 ? '+' : ''}
          {fmtNum(pnl, 2)}
        </Text>
      </View>
      <View style={styles.metrics}>
        <Metric label="Lots" value={`${pos.lots} × ${fmtNum(pos.lotSize, pos.lotSize % 1 === 0 ? 0 : 2)}`} />
        <Metric label="Avg" value={fmtNum(pos.avgPrice, 2)} center />
        <Metric label="LTP" value={fmtNum(pos.ltp, 2)} center />
        <Metric label={pos.product} value={currency} right dim />
      </View>

      {panel === 'sl' ? (
        <>
          <View style={styles.slRow}>
            <TextInput style={styles.slInput} value={slDraft} onChangeText={setSlDraft} keyboardType="decimal-pad" placeholder="SL price" placeholderTextColor={theme.colors.textFaint} />
            <TextInput style={styles.slInput} value={tgtDraft} onChangeText={setTgtDraft} keyboardType="decimal-pad" placeholder="Target price" placeholderTextColor={theme.colors.textFaint} />
          </View>
          <View style={styles.slRow}>
            <TextInput style={styles.slInput} value={trailDraft} onChangeText={setTrailDraft} keyboardType="decimal-pad" placeholder="Trail SL (points behind price)" placeholderTextColor={theme.colors.textFaint} />
            <TouchableOpacity style={styles.slSave} onPress={saveSl}>
              <Text style={styles.slSaveTxt}>Set</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {panel === 'exit' ? (
        <View style={styles.slRow}>
          <View style={styles.exitStepper}>
            <TouchableOpacity style={styles.exitStepBtn} onPress={() => setExitLots((n) => Math.max(1, n - 1))}>
              <Text style={styles.exitStepTxt}>–</Text>
            </TouchableOpacity>
            <Text style={styles.exitLots}>
              {exitLots}/{pos.lots}
            </Text>
            <TouchableOpacity style={styles.exitStepBtn} onPress={() => setExitLots((n) => Math.min(pos.lots, n + 1))}>
              <Text style={styles.exitStepTxt}>+</Text>
            </TouchableOpacity>
          </View>
          <TextInput style={styles.slInput} value={exitLimit} onChangeText={setExitLimit} keyboardType="decimal-pad" placeholder={`Limit (blank = mkt @${fmtNum(pos.ltp, 2)})`} placeholderTextColor={theme.colors.textFaint} />
          <TouchableOpacity style={[styles.slSave, { backgroundColor: theme.colors.sell }]} onPress={doExit}>
            <Text style={styles.slSaveTxt}>Exit</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {flash ? <Text style={styles.flash}>{flash}</Text> : null}

      <View style={styles.btmRow}>
        <TouchableOpacity style={styles.sqBtn} onPress={panel === 'exit' ? () => setPanel('none') : openExit}>
          <Text style={styles.sqTxt}>{panel === 'exit' ? 'Cancel' : 'Exit ▾'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.sqBtn} onPress={panel === 'sl' ? () => setPanel('none') : openSl}>
          <Text style={styles.sqTxt}>{panel === 'sl' ? 'Cancel' : slBadge}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Order book + fill history. */
export function PaperOrders() {
  const orders = usePaperStore((s) => s.orders);
  const trades = usePaperStore((s) => s.trades);
  const cancelOrder = usePaperStore((s) => s.cancelOrder);

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      <Text style={styles.sectionTitle}>Orders</Text>
      {orders.length === 0 ? (
        <Text style={styles.hint}>No orders yet.</Text>
      ) : (
        orders.map((o) => <OrderRow key={o.id} o={o} onCancel={() => cancelOrder(o.id)} />)
      )}

      <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Trade history</Text>
      {trades.length === 0 ? (
        <Text style={styles.hint}>No fills yet.</Text>
      ) : (
        trades.map((t) => (
          <View key={t.id} style={styles.tradeRow}>
            <View style={[styles.dot, { backgroundColor: t.action === 'BUY' ? theme.colors.buy : theme.colors.sell }]} />
            <Text style={styles.tradeSym} numberOfLines={1}>
              {t.action} {t.lots}×{fmtNum(t.lotSize, t.lotSize % 1 === 0 ? 0 : 2)} {t.symbol}
            </Text>
            {t.tag ? <Text style={styles.tradeTag}>{t.tag}</Text> : null}
            <Text style={styles.tradePrice}>@{fmtNum(t.price, 2)}</Text>
            {t.realized != null ? (
              <Text style={[styles.tradePnl, { color: t.realized >= 0 ? theme.colors.profit : theme.colors.loss }]}>
                {t.realized >= 0 ? '+' : ''}
                {fmtNum(t.realized, 0)}
              </Text>
            ) : (
              <Text style={styles.tradeKind}>{t.kind}</Text>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

function OrderRow({ o, onCancel }: { o: PaperOrder; onCancel: () => void }) {
  const statusColor =
    o.status === 'FILLED'
      ? theme.colors.profit
      : o.status === 'PENDING'
        ? theme.colors.primary
        : theme.colors.textDim;
  return (
    <View style={styles.orderRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.orderSym} numberOfLines={1}>
          <Text style={{ color: o.action === 'BUY' ? theme.colors.buy : theme.colors.sell, fontWeight: '800' }}>
            {o.action}
          </Text>{' '}
          {o.lots} lot · {o.symbol}
        </Text>
        <Text style={styles.orderMeta}>
          {o.orderType}
          {o.orderType === 'LIMIT' && o.limitPrice != null ? ` @ ${fmtNum(o.limitPrice, 2)}` : ''} ·{' '}
          {o.avgFillPrice != null ? `fill ${fmtNum(o.avgFillPrice, 2)}` : o.product}
        </Text>
      </View>
      <Text style={[styles.orderStatus, { color: statusColor }]}>{o.status}</Text>
      {o.status === 'PENDING' ? (
        <TouchableOpacity onPress={onCancel} hitSlop={8} style={styles.cancelBtn}>
          <Text style={styles.cancelTxt}>✕</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function Metric({
  label,
  value,
  center,
  right,
  dim,
}: {
  label: string;
  value: string;
  center?: boolean;
  right?: boolean;
  dim?: boolean;
}) {
  return (
    <View style={{ flex: 1, alignItems: right ? 'flex-end' : center ? 'center' : 'flex-start' }}>
      <Text style={styles.mLabel}>{label}</Text>
      <Text style={[styles.mVal, dim && { color: theme.colors.textDim }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  payoffCard: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: 8, marginBottom: 12 },
  payoffHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, marginBottom: 2 },
  payoffTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  payoffMeta: { color: theme.colors.textDim, fontSize: 11 },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyBig: { color: theme.colors.text, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  emptySmall: { color: theme.colors.textDim, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  count: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
  sqAll: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.sell },
  sqAllTxt: { color: theme.colors.sell, fontSize: 12, fontWeight: '700' },
  card: { backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 12, marginBottom: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  actTxt: { fontSize: 11, fontWeight: '800' },
  sym: { color: theme.colors.text, fontSize: 13, fontWeight: '700', flex: 1 },
  pnl: { fontSize: 14, fontWeight: '800' },
  metrics: { flexDirection: 'row', marginTop: 12 },
  mLabel: { color: theme.colors.textDim, fontSize: 10, marginBottom: 3 },
  mVal: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  btmRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  sqBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border },
  sqTxt: { color: theme.colors.text, fontSize: 12, fontWeight: '700' },
  slRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
  slInput: { flex: 1, backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: theme.colors.text, fontSize: 13 },
  slSave: { backgroundColor: theme.colors.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  slSaveTxt: { color: '#0B0E11', fontSize: 13, fontWeight: '800' },
  exitStepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border },
  exitStepBtn: { paddingHorizontal: 10, paddingVertical: 7 },
  exitStepTxt: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  exitLots: { color: theme.colors.text, fontSize: 13, fontWeight: '700', minWidth: 38, textAlign: 'center' },
  flash: { color: theme.colors.loss, fontSize: 11, marginTop: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingHorizontal: 4 },
  totalLabel: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
  totalVal: { fontSize: 16, fontWeight: '800' },
  sectionTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '800', marginBottom: 10 },
  hint: { color: theme.colors.textFaint, fontSize: 13, marginBottom: 6 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 11, marginBottom: 8 },
  orderSym: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  orderMeta: { color: theme.colors.textDim, fontSize: 11, marginTop: 3 },
  orderStatus: { fontSize: 11, fontWeight: '800' },
  cancelBtn: { paddingHorizontal: 6 },
  cancelTxt: { color: theme.colors.textDim, fontSize: 14, fontWeight: '700' },
  tradeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tradeSym: { color: theme.colors.text, fontSize: 12, flex: 1 },
  tradePrice: { color: theme.colors.textDim, fontSize: 12 },
  tradePnl: { fontSize: 12, fontWeight: '700', minWidth: 48, textAlign: 'right' },
  tradeKind: { color: theme.colors.textFaint, fontSize: 10, fontWeight: '700', minWidth: 48, textAlign: 'right' },
  tradeTag: { color: theme.colors.primary, fontSize: 9, fontWeight: '800', backgroundColor: theme.colors.primaryDim + '55', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
});
