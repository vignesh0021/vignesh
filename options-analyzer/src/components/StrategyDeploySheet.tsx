import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { theme } from '../theme';
import type { OptionAction, OptionType } from '../types';
import { fmtNum } from '../utils/format';
import { expiryTag } from '../utils/options';

/** A strategy leg resolved to a concrete live contract for the preview. */
export interface ResolvedLeg {
  action: OptionAction;
  optType: OptionType;
  ratio: number;
  strike: number;
  expiryIso: string;
  ltp: number;
  symbol: string;
}

const SHORT_MARGIN_RATE = 0.12;

/**
 * Deploy confirmation sheet: shows every resolved leg (live strike + premium)
 * with editable base lots and lot size, plus net premium and margin estimates,
 * before anything is placed. Mirrors a broker's basket-order preview.
 */
export function StrategyDeploySheet({
  visible,
  name,
  legs,
  initialLots,
  defaultLotSize,
  currency,
  live,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  name: string;
  legs: ResolvedLeg[];
  initialLots: number;
  defaultLotSize: number;
  currency: string;
  live: boolean;
  onConfirm: (lots: number, lotSize: number) => void;
  onClose: () => void;
}) {
  const [lots, setLots] = useState(initialLots);
  const [lotSizeStr, setLotSizeStr] = useState(String(defaultLotSize));

  useEffect(() => {
    if (visible) {
      setLots(initialLots);
      setLotSizeStr(String(defaultLotSize));
    }
  }, [visible, initialLots, defaultLotSize]);

  const lotSize = Math.max(0, Number(lotSizeStr) || 0);

  let netPremium = 0; // positive = debit paid, negative = credit received
  let margin = 0;
  for (const leg of legs) {
    const qty = leg.ratio * lots * lotSize;
    netPremium += (leg.action === 'BUY' ? 1 : -1) * leg.ltp * qty;
    margin += leg.action === 'BUY' ? leg.ltp * qty : leg.strike * qty * SHORT_MARGIN_RATE;
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.headRow}>
          <Text style={styles.title}>{name}</Text>
          <Text style={[styles.src, { color: live ? theme.colors.profit : theme.colors.primary }]}>
            {live ? '● live prices' : '● sim prices'}
          </Text>
        </View>

        {/* Legs preview */}
        {legs.map((leg, i) => (
          <View key={i} style={styles.legRow}>
            <Text style={[styles.legAction, { color: leg.action === 'BUY' ? theme.colors.buy : theme.colors.sell }]}>
              {leg.action}
            </Text>
            <Text style={styles.legTxt} numberOfLines={1}>
              {leg.ratio * lots} lot · {fmtNum(leg.strike, 0)} {leg.optType === 'CALL' ? 'CE' : 'PE'} ·{' '}
              {expiryTag(leg.expiryIso)}
            </Text>
            <Text style={styles.legLtp}>@{fmtNum(leg.ltp, 2)}</Text>
          </View>
        ))}

        {/* Lots + lot size editors */}
        <View style={styles.editRow}>
          <Text style={styles.editLabel}>Base lots</Text>
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setLots((n) => Math.max(1, n - 1))}>
              <Text style={styles.stepTxt}>–</Text>
            </TouchableOpacity>
            <Text style={styles.stepVal}>{lots}</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setLots((n) => n + 1)}>
              <Text style={styles.stepTxt}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.editLabel}>Lot size</Text>
          <TextInput
            style={styles.lotSizeInput}
            value={lotSizeStr}
            onChangeText={setLotSizeStr}
            keyboardType="decimal-pad"
            selectTextOnFocus
          />
        </View>

        {/* Totals */}
        <View style={styles.totals}>
          <Text style={styles.totTxt}>
            {netPremium >= 0 ? 'Net debit' : 'Net credit'}:{' '}
            <Text style={[styles.totVal, { color: netPremium >= 0 ? theme.colors.loss : theme.colors.profit }]}>
              {fmtNum(Math.abs(netPremium), 0)} {currency}
            </Text>
            {'   ·   '}Est. margin: <Text style={styles.totVal}>{fmtNum(margin, 0)} {currency}</Text>
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.confirm, lotSize <= 0 && { opacity: 0.5 }]}
          disabled={lotSize <= 0}
          onPress={() => onConfirm(lots, lotSize)}
          activeOpacity={0.85}
        >
          <Text style={styles.confirmTxt}>⚡ Confirm & Deploy {legs.length} leg{legs.length === 1 ? '' : 's'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancel} onPress={onClose}>
          <Text style={styles.cancelTxt}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000AA' },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 30, borderTopWidth: 1, borderColor: theme.colors.border },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, marginBottom: 12 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { color: theme.colors.text, fontSize: 16, fontWeight: '800', flexShrink: 1 },
  src: { fontSize: 11, fontWeight: '800' },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6 },
  legAction: { fontSize: 12, fontWeight: '800', width: 38 },
  legTxt: { color: theme.colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
  legLtp: { color: theme.colors.textDim, fontSize: 12, fontWeight: '700' },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 6, flexWrap: 'wrap' },
  editLabel: { color: theme.colors.textDim, fontSize: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border },
  stepBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  stepTxt: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  stepVal: { color: theme.colors.text, fontSize: 14, fontWeight: '700', minWidth: 26, textAlign: 'center' },
  lotSizeInput: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, color: theme.colors.text, fontSize: 14, fontWeight: '700', minWidth: 64, textAlign: 'center' },
  totals: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, padding: 10, marginTop: 6, marginBottom: 12 },
  totTxt: { color: theme.colors.textDim, fontSize: 12 },
  totVal: { color: theme.colors.text, fontWeight: '800' },
  confirm: { backgroundColor: theme.colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmTxt: { color: '#0B0E11', fontSize: 15, fontWeight: '800' },
  cancel: { alignItems: 'center', paddingVertical: 12 },
  cancelTxt: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
});
