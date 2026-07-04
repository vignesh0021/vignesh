import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { theme } from '../theme';
import type { OptionPosition } from '../types';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { fmtNum } from '../utils/format';

interface Props {
  onEdit: (p: OptionPosition) => void;
}

function contractLabel(p: OptionPosition): string {
  const t = p.type === 'CALL' ? 'C' : 'P';
  const d = p.expiry.replace(/-/g, '').slice(2);
  return `${t}-${p.strike}-${d}`;
}

/** List of legs with quick edit / close / reopen / delete controls. */
export function PositionList({ onEdit }: Props) {
  const open = usePortfolioStore((s) => s.openPositions);
  const closed = usePortfolioStore((s) => s.closedPositions);
  const closePosition = usePortfolioStore((s) => s.closePosition);
  const reopenPosition = usePortfolioStore((s) => s.reopenPosition);
  const removePosition = usePortfolioStore((s) => s.removePosition);

  const [closingId, setClosingId] = useState<string | null>(null);
  const [exitPx, setExitPx] = useState('');

  return (
    <View>
      <Text style={styles.section}>Open Positions ({open.length})</Text>
      {open.length === 0 ? <Text style={styles.empty}>No open legs. Tap “Add Contract”.</Text> : null}

      {open.map((p) => (
        <View key={p.id} style={styles.card}>
          <View style={styles.left}>
            <Badge action={p.action} />
            <View>
              <Text style={styles.name}>{contractLabel(p)}</Text>
              <Text style={styles.meta}>
                {fmtNum(p.lots * p.lotSize, 3)} {p.instrument} · entry {fmtNum(p.entryPremium, 1)} · IV {fmtNum(p.iv * 100, 0)}%
              </Text>
            </View>
          </View>

          {closingId === p.id ? (
            <View style={styles.closeRow}>
              <TextInput
                style={styles.exitInput}
                placeholder="exit px"
                placeholderTextColor={theme.colors.textFaint}
                keyboardType="numeric"
                value={exitPx}
                onChangeText={setExitPx}
                autoFocus
              />
              <TouchableOpacity
                onPress={() => {
                  closePosition(p.id, Number(exitPx) || p.entryPremium);
                  setClosingId(null);
                  setExitPx('');
                }}
              >
                <Text style={styles.confirm}>✓</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity onPress={() => onEdit(p)} hitSlop={8}>
                <Text style={styles.action}>✎</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setClosingId(p.id)} hitSlop={8}>
                <Text style={styles.action}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => removePosition(p.id)} hitSlop={8}>
                <Text style={[styles.action, { color: theme.colors.loss }]}>🗑</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}

      {closed.length > 0 ? (
        <>
          <Text style={styles.section}>Closed Positions ({closed.length})</Text>
          {closed.map((p) => (
            <View key={p.id} style={[styles.card, styles.closedCard]}>
              <View style={styles.left}>
                <Badge action={p.action} closed />
                <View>
                  <Text style={[styles.name, { color: theme.colors.textDim }]}>{contractLabel(p)}</Text>
                  <Text style={styles.meta}>
                    Realized{' '}
                    <Text style={{ color: (p.realizedPnl ?? 0) >= 0 ? theme.colors.profit : theme.colors.loss }}>
                      {fmtNum(p.realizedPnl ?? 0, 2)} USD
                    </Text>{' '}
                    · Greeks 0
                  </Text>
                </View>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => reopenPosition(p.id)} hitSlop={8}>
                  <Text style={styles.action}>Reopen</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removePosition(p.id)} hitSlop={8}>
                  <Text style={[styles.action, { color: theme.colors.loss }]}>🗑</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

function Badge({ action, closed }: { action: 'BUY' | 'SELL'; closed?: boolean }) {
  const isSell = action === 'SELL';
  const color = closed ? theme.colors.textFaint : isSell ? theme.colors.sell : theme.colors.buy;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeTxt, { color }]}>{isSell ? 'S' : 'B'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { color: theme.colors.textDim, fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 8, marginHorizontal: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { color: theme.colors.textFaint, fontSize: 13, marginHorizontal: 12 },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderColor: theme.colors.border,
    borderWidth: 1,
  },
  closedCard: { opacity: 0.75 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  name: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  meta: { color: theme.colors.textDim, fontSize: 11, marginTop: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  action: { color: theme.colors.primary, fontSize: 14 },
  closeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exitInput: {
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    color: theme.colors.text,
    width: 74,
    fontSize: 13,
  },
  confirm: { color: theme.colors.profit, fontSize: 20, fontWeight: '700' },
  badge: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badgeTxt: { fontSize: 11, fontWeight: '700' },
});
