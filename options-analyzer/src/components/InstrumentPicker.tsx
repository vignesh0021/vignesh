import React, { useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { INSTRUMENTS, INSTRUMENT_KEYS, type InstrumentKey } from '../constants/instruments';
import { theme } from '../theme';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { fmtNum } from '../utils/format';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Market panel: pick a preset script (BTC / Nifty / Bank Nifty), auto-fetch its
 * live spot + volatility index, and override either value manually if a fetch
 * came back wrong.
 */
export function InstrumentPicker({ visible, onClose }: Props) {
  const instrumentKey = usePortfolioStore((s) => s.instrumentKey);
  const spotPrice = usePortfolioStore((s) => s.spotPrice);
  const defaultIv = usePortfolioStore((s) => s.defaultIv);
  const spotSource = usePortfolioStore((s) => s.spotSource);
  const vixSource = usePortfolioStore((s) => s.vixSource);
  const marketLoading = usePortfolioStore((s) => s.marketLoading);
  const marketError = usePortfolioStore((s) => s.marketError);
  const lastFetched = usePortfolioStore((s) => s.lastFetched);

  const selectInstrument = usePortfolioStore((s) => s.selectInstrument);
  const refreshMarket = usePortfolioStore((s) => s.refreshMarket);
  const setSpotPrice = usePortfolioStore((s) => s.setSpotPrice);
  const setDefaultIv = usePortfolioStore((s) => s.setDefaultIv);

  const [spotEdit, setSpotEdit] = useState<string | null>(null);
  const [ivEdit, setIvEdit] = useState<string | null>(null);

  const preset = INSTRUMENTS[instrumentKey];
  const updated = lastFetched ? new Date(lastFetched).toLocaleTimeString() : '—';

  const commitSpot = () => {
    if (spotEdit != null) {
      const v = Number(spotEdit);
      if (v > 0) setSpotPrice(v);
      setSpotEdit(null);
    }
  };
  const commitIv = () => {
    if (ivEdit != null) {
      const v = Number(ivEdit);
      if (v > 0) setDefaultIv(v / 100);
      setIvEdit(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.tap} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Market / Instrument</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* preset chips */}
          <View style={styles.chips}>
            {INSTRUMENT_KEYS.map((key) => {
              const active = key === instrumentKey;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => selectInstrument(key)}
                >
                  <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>
                    {INSTRUMENTS[key].symbol}
                  </Text>
                  <Text style={[styles.chipSub, active && { color: '#0B0E11' }]}>
                    {INSTRUMENTS[key].label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* status line */}
          <View style={styles.statusRow}>
            {marketLoading ? (
              <View style={styles.statusInline}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={styles.statusTxt}>Fetching live data…</Text>
              </View>
            ) : (
              <Text style={styles.statusTxt}>
                Spot: {spotSource ?? '—'} · Vol: {vixSource ?? '—'} · {updated}
              </Text>
            )}
            <TouchableOpacity onPress={refreshMarket} hitSlop={8}>
              <Text style={styles.refresh}>↻ Fetch live</Text>
            </TouchableOpacity>
          </View>
          {marketError ? <Text style={styles.error}>{marketError}</Text> : null}

          {/* manual overrides */}
          <View style={styles.fieldRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Spot Price ({preset.currency})</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={spotEdit ?? fmtNum(spotPrice, 2)}
                onFocus={() => setSpotEdit(String(spotPrice))}
                onChangeText={setSpotEdit}
                onBlur={commitSpot}
                onSubmitEditing={commitSpot}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>{preset.vixLabel} / Default IV (%)</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={ivEdit ?? fmtNum(defaultIv * 100, 1)}
                onFocus={() => setIvEdit(String(fmtNum(defaultIv * 100, 1)))}
                onChangeText={setIvEdit}
                onBlur={commitIv}
                onSubmitEditing={commitIv}
              />
            </View>
          </View>

          <Text style={styles.hint}>
            Live spot comes from {instrumentKey === 'BTC' ? 'Binance / Yahoo' : 'Yahoo Finance'}; the
            default IV from {preset.vixLabel}. Both feed new legs — edit above if a quote looks off.
          </Text>

          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneTxt}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  tap: { flex: 1 },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 28,
  },
  handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, marginBottom: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  close: { color: theme.colors.textDim, fontSize: 18 },
  chips: { flexDirection: 'row', gap: 10 },
  chip: {
    flex: 1, backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, borderWidth: 1,
    borderColor: theme.colors.border, paddingVertical: 12, alignItems: 'center',
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipTxt: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  chipTxtActive: { color: '#0B0E11' },
  chipSub: { color: theme.colors.textDim, fontSize: 11, marginTop: 2 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  statusInline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusTxt: { color: theme.colors.textDim, fontSize: 12, flexShrink: 1 },
  refresh: { color: theme.colors.primary, fontSize: 13, fontWeight: '600' },
  error: { color: theme.colors.loss, fontSize: 12, marginTop: 8 },
  fieldRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  fieldLabel: { color: theme.colors.textDim, fontSize: 12, marginBottom: 6 },
  input: {
    backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: theme.colors.text, fontSize: 15,
  },
  hint: { color: theme.colors.textFaint, fontSize: 12, marginTop: 14, lineHeight: 18 },
  doneBtn: { backgroundColor: theme.colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  doneTxt: { color: '#0B0E11', fontSize: 15, fontWeight: '700' },
});
