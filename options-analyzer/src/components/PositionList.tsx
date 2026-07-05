import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { bsPrice } from '../hooks/useBlackScholes';
import { theme } from '../theme';
import type { OptionPosition } from '../types';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { daysBetween, fmtNum, todayIso } from '../utils/format';
import { legSign, legSize } from '../utils/payoff';

interface Props {
  onEdit: (p: OptionPosition) => void;
}

function contractLabel(p: OptionPosition): string {
  const d = p.expiry.replace(/-/g, '').slice(2);
  if (p.instrumentType === 'FUTURE') return `${p.instrument} FUT-${d}`;
  const t = p.type === 'CALL' ? 'C' : 'P';
  return `${t}-${p.strike}-${d}`;
}

/** Current mark (entered LTP if any, else Black-Scholes now) and UPL@Mark. */
function markAndUpl(p: OptionPosition, spot: number, rate: number): { mark: number; upl: number } {
  let bsNow: number;
  if (p.instrumentType === 'FUTURE') {
    bsNow = spot;
  } else {
    const days = Math.max(daysBetween(todayIso(), p.expiry), 0);
    bsNow = bsPrice({ spot, strike: p.strike, timeYears: days / 365, rate, iv: p.iv, type: p.type });
  }
  const mark = p.markPrice ?? bsNow;
  const upl = legSign(p) * (mark - p.entryPremium) * legSize(p);
  return { mark, upl };
}

/**
 * Delta-Exchange-style positions monitor: per-leg quantity, live mark and
 * UPL@Mark, with a search filter, plus edit / close / reopen / delete.
 */
export function PositionList({ onEdit }: Props) {
  const open = usePortfolioStore((s) => s.openPositions);
  const closed = usePortfolioStore((s) => s.closedPositions);
  const spotPrice = usePortfolioStore((s) => s.spotPrice);
  const rate = usePortfolioStore((s) => s.rate);
  const closePosition = usePortfolioStore((s) => s.closePosition);
  const reopenPosition = usePortfolioStore((s) => s.reopenPosition);
  const removePosition = usePortfolioStore((s) => s.removePosition);

  const [closingId, setClosingId] = useState<string | null>(null);
  const [exitPx, setExitPx] = useState('');
  const [query, setQuery] = useState('');

  const q = query.trim().toUpperCase();
  const match = (p: OptionPosition) =>
    q.length === 0 || contractLabel(p).toUpperCase().includes(q) || p.instrument.toUpperCase().includes(q);

  const openF = useMemo(() => open.filter(match), [open, q]);
  const closedF = useMemo(() => closed.filter(match), [closed, q]);

  return (
    <View>
      {/* search */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="🔍  Search positions"
          placeholderTextColor={theme.colors.textFaint}
          autoCapitalize="characters"
        />
      </View>

      <Text style={styles.section}>Open Positions ({openF.length})</Text>
      {openF.length === 0 ? <Text style={styles.empty}>No open legs. Tap “Add Contract”.</Text> : null}

      {openF.map((p) => {
        const isShort = p.action === 'SELL';
        const { mark, upl } = markAndUpl(p, spotPrice, rate);
        return (
          <View key={p.id} style={styles.card}>
            <View style={styles.cardHead}>
              <View style={[styles.bar, { backgroundColor: isShort ? theme.colors.sell : theme.colors.buy }]} />
              <Text style={styles.name}>{contractLabel(p)}</Text>
              {p.instrumentType === 'FUTURE' ? <Text style={styles.futTag}>FUT</Text> : null}
            </View>

            <View style={styles.metricsRow}>
              <Metric label="Quantity" value={`${isShort ? '-' : '+'}${fmtNum(p.lots, 0)} Lots`} />
              <Metric label={p.markPrice != null ? 'Mark (LTP)' : 'Mark (model)'} value={fmtNum(mark, 1)} center />
              <Metric
                label="UPL@Mark"
                value={`${upl >= 0 ? '+' : ''}${fmtNum(upl, 2)}`}
                color={upl >= 0 ? theme.colors.profit : theme.colors.loss}
                right
              />
            </View>

            {closingId === p.id ? (
              <View style={styles.closeRow}>
                <TextInput
                  style={styles.exitInput}
                  placeholder="exit price"
                  placeholderTextColor={theme.colors.textFaint}
                  keyboardType="numeric"
                  value={exitPx}
                  onChangeText={setExitPx}
                  autoFocus
                />
                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={() => {
                    closePosition(p.id, Number(exitPx) || mark);
                    setClosingId(null);
                    setExitPx('');
                  }}
                >
                  <Text style={styles.confirmTxt}>Confirm Close</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setClosingId(null)}>
                  <Text style={styles.cancel}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.actionsRow}>
                <ActionBtn label="Edit" onPress={() => onEdit(p)} />
                <ActionBtn label="Close" color={theme.colors.loss} onPress={() => { setExitPx(fmtNum(mark, 1)); setClosingId(p.id); }} />
                <ActionBtn label="Delete" color={theme.colors.textDim} onPress={() => removePosition(p.id)} />
              </View>
            )}
          </View>
        );
      })}

      {closedF.length > 0 ? (
        <>
          <Text style={styles.section}>Closed Positions ({closedF.length})</Text>
          {closedF.map((p) => (
            <View key={p.id} style={[styles.card, styles.closedCard]}>
              <View style={styles.cardHead}>
                <View style={[styles.bar, { backgroundColor: theme.colors.textFaint }]} />
                <Text style={[styles.name, { color: theme.colors.textDim }]}>{contractLabel(p)}</Text>
              </View>
              <View style={styles.metricsRow}>
                <Metric label="Quantity" value={`${p.action === 'SELL' ? '-' : '+'}${fmtNum(p.lots, 0)} Lots`} />
                <Metric label="Exit" value={fmtNum(p.exitPremium ?? 0, 1)} center />
                <Metric
                  label="Realized"
                  value={`${(p.realizedPnl ?? 0) >= 0 ? '+' : ''}${fmtNum(p.realizedPnl ?? 0, 2)}`}
                  color={(p.realizedPnl ?? 0) >= 0 ? theme.colors.profit : theme.colors.loss}
                  right
                />
              </View>
              <View style={styles.actionsRow}>
                <ActionBtn label="Reopen" onPress={() => reopenPosition(p.id)} />
                <ActionBtn label="Delete" color={theme.colors.textDim} onPress={() => removePosition(p.id)} />
              </View>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

function Metric({
  label,
  value,
  color,
  center,
  right,
}: {
  label: string;
  value: string;
  color?: string;
  center?: boolean;
  right?: boolean;
}) {
  return (
    <View style={{ flex: 1, alignItems: right ? 'flex-end' : center ? 'center' : 'flex-start' }}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

function ActionBtn({ label, color, onPress }: { label: string; color?: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress} hitSlop={6}>
      <Text style={[styles.actionTxt, color ? { color } : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 12, paddingTop: 12 },
  search: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: theme.colors.text, fontSize: 14 },
  section: { color: theme.colors.textDim, fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 8, marginHorizontal: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { color: theme.colors.textFaint, fontSize: 13, marginHorizontal: 12 },
  card: { backgroundColor: theme.colors.surface, marginHorizontal: 12, marginBottom: 10, padding: 12, borderRadius: 10, borderColor: theme.colors.border, borderWidth: 1 },
  closedCard: { opacity: 0.8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bar: { width: 4, height: 18, borderRadius: 2 },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  futTag: { color: theme.colors.primary, fontSize: 10, fontWeight: '700', borderColor: theme.colors.primary, borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  metricsRow: { flexDirection: 'row', marginTop: 12, marginBottom: 4 },
  metricLabel: { color: theme.colors.textDim, fontSize: 11, marginBottom: 4 },
  metricValue: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  actionsRow: { flexDirection: 'row', marginTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 8, gap: 8 },
  actionBtn: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surfaceAlt },
  actionTxt: { color: theme.colors.primary, fontSize: 13, fontWeight: '600' },
  closeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  exitInput: { flex: 1, backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: theme.colors.text, fontSize: 13 },
  confirmBtn: { backgroundColor: theme.colors.loss, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  confirmTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cancel: { color: theme.colors.textDim, fontSize: 16, paddingHorizontal: 4 },
});
