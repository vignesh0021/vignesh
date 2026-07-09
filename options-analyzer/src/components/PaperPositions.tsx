import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { theme } from '../theme';
import { fmtNum } from '../utils/format';
import { usePaperStore, positionPnl, type PaperOrder, type PaperPosition } from '../store/usePaperStore';

/** Live paper positions with mark-to-market P&L and one-tap square-off. */
export function PaperPositions({ currency }: { currency: string }) {
  const positions = usePaperStore((s) => s.positions);
  const squareOff = usePaperStore((s) => s.squareOff);
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
      <View style={styles.topRow}>
        <Text style={styles.count}>{positions.length} open</Text>
        <TouchableOpacity style={styles.sqAll} onPress={squareOffAll}>
          <Text style={styles.sqAllTxt}>Square off all</Text>
        </TouchableOpacity>
      </View>
      {positions.map((p) => (
        <PositionCard key={p.id} pos={p} currency={currency} onSquareOff={() => squareOff(p.id)} />
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

function PositionCard({
  pos,
  currency,
  onSquareOff,
}: {
  pos: PaperPosition;
  currency: string;
  onSquareOff: () => void;
}) {
  const pnl = positionPnl(pos);
  const isBuy = pos.action === 'BUY';
  const color = isBuy ? theme.colors.buy : theme.colors.sell;
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
      <TouchableOpacity style={styles.sqBtn} onPress={onSquareOff}>
        <Text style={styles.sqTxt}>Square off</Text>
      </TouchableOpacity>
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
  sqBtn: { marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border },
  sqTxt: { color: theme.colors.text, fontSize: 12, fontWeight: '700' },
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
});
