import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { priceContract } from '../services/optionChain';
import { theme } from '../theme';
import type { OptionAction } from '../types';
import { fmtNum } from '../utils/format';
import { expiryLabel } from '../utils/options';
import {
  usePaperStore,
  type Contract,
  type PaperOrderType,
  type ProductType,
} from '../store/usePaperStore';

/**
 * Paper order ticket — a Zerodha/Fyers-style bottom sheet to place a simulated
 * BUY/SELL on the tapped option. LTP marks live off the underlying spot.
 */
export function OrderTicket({
  visible,
  contract,
  initialAction,
  spot,
  currency,
  onClose,
}: {
  visible: boolean;
  contract: Contract | null;
  initialAction: OptionAction;
  spot: number;
  currency: string;
  onClose: () => void;
}) {
  const placeOrder = usePaperStore((s) => s.placeOrder);
  const [action, setAction] = useState<OptionAction>(initialAction);
  const [orderType, setOrderType] = useState<PaperOrderType>('MARKET');
  const [product, setProduct] = useState<ProductType>('NRML');
  const [lots, setLots] = useState('1');
  const [limit, setLimit] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setAction(initialAction);
      setOrderType('MARKET');
      setLots('1');
      setLimit('');
      setFlash(null);
    }
  }, [visible, initialAction, contract?.key]);

  const ltp = useMemo(
    () =>
      contract ? priceContract(spot, contract.strike, contract.optType, contract.expiryIso, contract.iv, contract.rate) : 0,
    [contract, spot],
  );

  useEffect(() => {
    if (visible && orderType === 'LIMIT' && limit === '' && ltp > 0) setLimit(ltp.toFixed(2));
  }, [orderType, visible, ltp, limit]);

  if (!contract) return null;

  const lotsNum = Math.max(0, Math.floor(Number(lots) || 0));
  const qty = lotsNum * contract.lotSize;
  const priceUsed = orderType === 'MARKET' ? ltp : Number(limit) || ltp;
  const turnover = priceUsed * qty;
  const isBuy = action === 'BUY';
  const marginEst = isBuy ? turnover : contract.strike * qty * 0.12;

  const submit = () => {
    if (lotsNum <= 0) {
      setFlash('Enter at least 1 lot');
      return;
    }
    const res = placeOrder(
      {
        ...contract,
        action,
        orderType,
        product,
        lots: lotsNum,
        limitPrice: orderType === 'LIMIT' ? Number(limit) || ltp : undefined,
      },
      ltp,
    );
    if (!res.ok) {
      setFlash(res.reason ?? 'Order rejected');
      return;
    }
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.headRow}>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.symbol}>{contract.symbol}</Text>
            <Text style={styles.sub}>
              {contract.underlying} · {expiryLabel(contract.expiryIso)} · Lot {contract.lotSize}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.ltpLabel}>LTP</Text>
            <Text style={styles.ltp}>{fmtNum(ltp, 2)}</Text>
          </View>
        </View>

        {/* BUY / SELL */}
        <View style={styles.segRow}>
          <TouchableOpacity
            style={[styles.seg, isBuy && { backgroundColor: theme.colors.buy }]}
            onPress={() => setAction('BUY')}
          >
            <Text style={[styles.segTxt, isBuy && styles.segTxtOn]}>BUY</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.seg, !isBuy && { backgroundColor: theme.colors.sell }]}
            onPress={() => setAction('SELL')}
          >
            <Text style={[styles.segTxt, !isBuy && styles.segTxtOn]}>SELL</Text>
          </TouchableOpacity>
        </View>

        {/* Lots */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Lots</Text>
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setLots(String(Math.max(1, lotsNum - 1)))}>
              <Text style={styles.stepTxt}>–</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.lotInput}
              value={lots}
              onChangeText={setLots}
              keyboardType="number-pad"
              selectTextOnFocus
            />
            <TouchableOpacity style={styles.stepBtn} onPress={() => setLots(String(lotsNum + 1))}>
              <Text style={styles.stepTxt}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.qtyHint}>= {fmtNum(qty, qty % 1 === 0 ? 0 : 2)} qty</Text>
        </View>

        {/* Order type */}
        <View style={styles.pillRow}>
          {(['MARKET', 'LIMIT'] as PaperOrderType[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.pill, orderType === t && styles.pillOn]}
              onPress={() => setOrderType(t)}
            >
              <Text style={[styles.pillTxt, orderType === t && styles.pillTxtOn]}>{t}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ width: 12 }} />
          {(['NRML', 'MIS'] as ProductType[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.pill, product === t && styles.pillOn]}
              onPress={() => setProduct(t)}
            >
              <Text style={[styles.pillTxt, product === t && styles.pillTxtOn]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {orderType === 'LIMIT' ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Limit price</Text>
            <TextInput
              style={styles.limitInput}
              value={limit}
              onChangeText={setLimit}
              keyboardType="decimal-pad"
              placeholder={ltp.toFixed(2)}
              placeholderTextColor={theme.colors.textFaint}
            />
          </View>
        ) : null}

        <View style={styles.summary}>
          <Text style={styles.sumTxt}>
            {orderType === 'LIMIT' ? 'Rests until price is hit · ' : ''}
            Est. {isBuy ? 'premium' : 'margin'}:{' '}
            <Text style={styles.sumVal}>
              {fmtNum(marginEst, 0)} {currency}
            </Text>
          </Text>
        </View>

        {flash ? <Text style={styles.flash}>{flash}</Text> : null}

        <TouchableOpacity
          style={[styles.place, { backgroundColor: isBuy ? theme.colors.buy : theme.colors.sell }]}
          onPress={submit}
          activeOpacity={0.85}
        >
          <Text style={styles.placeTxt}>
            {orderType === 'MARKET' ? 'PLACE' : 'PLACE LIMIT'} {action} · {lotsNum} lot{lotsNum === 1 ? '' : 's'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.paperNote}>📝 Paper trade — simulated, no real order is sent.</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000AA' },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderColor: theme.colors.border,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, marginBottom: 14 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  symbol: { color: theme.colors.text, fontSize: 16, fontWeight: '800' },
  sub: { color: theme.colors.textDim, fontSize: 12, marginTop: 3 },
  ltpLabel: { color: theme.colors.textDim, fontSize: 11 },
  ltp: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
  segRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  seg: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border },
  segTxt: { color: theme.colors.textDim, fontWeight: '800', fontSize: 15 },
  segTxtOn: { color: '#0B0E11' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 12 },
  fieldLabel: { color: theme.colors.textDim, fontSize: 13, width: 84 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border },
  stepBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  stepTxt: { color: theme.colors.text, fontSize: 20, fontWeight: '700' },
  lotInput: { color: theme.colors.text, fontSize: 16, fontWeight: '700', minWidth: 48, textAlign: 'center', paddingVertical: 8 },
  qtyHint: { color: theme.colors.textFaint, fontSize: 12 },
  pillRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border },
  pillOn: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryDim },
  pillTxt: { color: theme.colors.textDim, fontSize: 12, fontWeight: '700' },
  pillTxtOn: { color: theme.colors.text },
  limitInput: { flex: 1, backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: theme.colors.text, fontSize: 15 },
  summary: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, padding: 12, marginBottom: 12 },
  sumTxt: { color: theme.colors.textDim, fontSize: 12 },
  sumVal: { color: theme.colors.text, fontWeight: '700' },
  flash: { color: theme.colors.loss, fontSize: 12, marginBottom: 8 },
  place: { paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  placeTxt: { color: '#0B0E11', fontWeight: '800', fontSize: 15 },
  paperNote: { color: theme.colors.textFaint, fontSize: 11, textAlign: 'center', marginTop: 10 },
});
