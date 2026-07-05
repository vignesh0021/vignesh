import React, { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { PRESET_ASSETS, type MarketAsset } from '../constants/instruments';
import { searchSymbols } from '../services/marketData';
import { theme } from '../theme';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { fmtNum } from '../utils/format';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Market panel: pick a preset, or search the whole NSE / BSE / crypto universe
 * (Yahoo symbol search). Auto-fetches spot + a volatility index, with editable
 * overrides if a quote comes back wrong.
 */
export function InstrumentPicker({ visible, onClose }: Props) {
  const asset = usePortfolioStore((s) => s.asset);
  const spotPrice = usePortfolioStore((s) => s.spotPrice);
  const defaultIv = usePortfolioStore((s) => s.defaultIv);
  const spotSource = usePortfolioStore((s) => s.spotSource);
  const vixSource = usePortfolioStore((s) => s.vixSource);
  const marketLoading = usePortfolioStore((s) => s.marketLoading);
  const marketError = usePortfolioStore((s) => s.marketError);
  const lastFetched = usePortfolioStore((s) => s.lastFetched);

  const rate = usePortfolioStore((s) => s.rate);
  const deltaRegion = usePortfolioStore((s) => s.deltaRegion);
  const setDeltaRegion = usePortfolioStore((s) => s.setDeltaRegion);
  const selectAsset = usePortfolioStore((s) => s.selectAsset);
  const refreshMarket = usePortfolioStore((s) => s.refreshMarket);
  const setSpotPrice = usePortfolioStore((s) => s.setSpotPrice);
  const setDefaultIv = usePortfolioStore((s) => s.setDefaultIv);
  const setRate = usePortfolioStore((s) => s.setRate);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MarketAsset[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [spotEdit, setSpotEdit] = useState<string | null>(null);
  const [ivEdit, setIvEdit] = useState<string | null>(null);
  const [rateEdit, setRateEdit] = useState<string | null>(null);

  const updated = lastFetched ? new Date(lastFetched).toLocaleTimeString() : '—';

  const runSearch = async () => {
    if (query.trim().length < 1) return;
    setSearching(true);
    setSearchErr(null);
    try {
      const hits = await searchSymbols(query);
      setResults(hits);
      if (hits.length === 0) setSearchErr('No matches. Try a ticker like RELIANCE, INFY, TCS, ETH.');
    } catch {
      setSearchErr('Search failed — check connection or type an exact symbol.');
    } finally {
      setSearching(false);
    }
  };

  const pick = (a: MarketAsset) => {
    setResults([]);
    setQuery('');
    selectAsset(a);
  };

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
  const commitRate = () => {
    if (rateEdit != null) {
      const v = Number(rateEdit);
      if (v >= 0) setRate(v / 100);
      setRateEdit(null);
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

          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}>
            {/* preset chips */}
            <View style={styles.chips}>
              {PRESET_ASSETS.map((a) => {
                const active = a.yahoo === asset.yahoo;
                return (
                  <TouchableOpacity key={a.yahoo} style={[styles.chip, active && styles.chipActive]} onPress={() => selectAsset(a)}>
                    <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{a.symbol}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* universe search */}
            <Text style={styles.fieldLabel}>Search any stock / crypto (NSE · BSE · crypto)</Text>
            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={runSearch}
                placeholder="e.g. RELIANCE, TCS, INFY, ETH, DOGE"
                placeholderTextColor={theme.colors.textFaint}
                autoCapitalize="characters"
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.searchBtn} onPress={runSearch}>
                {searching ? <ActivityIndicator size="small" color="#0B0E11" /> : <Text style={styles.searchBtnTxt}>Search</Text>}
              </TouchableOpacity>
            </View>
            {searchErr ? <Text style={styles.error}>{searchErr}</Text> : null}

            {results.map((a) => (
              <TouchableOpacity key={a.yahoo} style={styles.resultRow} onPress={() => pick(a)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultSym}>{a.symbol} <Text style={styles.resultYahoo}>({a.yahoo})</Text></Text>
                  <Text style={styles.resultName}>{a.label}</Text>
                </View>
                <Text style={styles.resultClass}>{a.assetClass === 'india_equity' ? 'NSE/BSE' : a.assetClass === 'crypto' ? 'Crypto' : 'Other'}</Text>
              </TouchableOpacity>
            ))}

            {/* current asset + live status */}
            <View style={styles.currentRow}>
              <Text style={styles.currentSym}>{asset.symbol}</Text>
              <Text style={styles.currentName}>{asset.label} · {asset.currency}</Text>
            </View>
            <View style={styles.statusRow}>
              {marketLoading ? (
                <View style={styles.statusInline}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text style={styles.statusTxt}>Fetching live data…</Text>
                </View>
              ) : (
                <Text style={styles.statusTxt}>Spot: {spotSource ?? '—'} · Vol: {vixSource ?? '—'} · {updated}</Text>
              )}
              <TouchableOpacity onPress={refreshMarket} hitSlop={8}>
                <Text style={styles.refresh}>↻ Fetch live</Text>
              </TouchableOpacity>
            </View>
            {marketError ? <Text style={styles.error}>{marketError}</Text> : null}

            {asset.assetClass === 'crypto' ? (
              <View style={styles.deltaRow}>
                <Text style={styles.deltaLabel}>Delta Exchange venue (live crypto spot)</Text>
                <View style={styles.deltaToggle}>
                  {(['india', 'global'] as const).map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.deltaBtn, deltaRegion === r && styles.deltaBtnActive]}
                      onPress={() => setDeltaRegion(r)}
                    >
                      <Text style={[styles.deltaBtnTxt, deltaRegion === r && styles.deltaBtnTxtActive]}>
                        {r === 'india' ? 'India' : 'Global'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            {/* manual overrides */}
            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Spot Price ({asset.currency})</Text>
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
                <Text style={styles.fieldLabel}>{asset.vixLabel} / Default IV (%)</Text>
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

            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Risk-free rate (%)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={rateEdit ?? fmtNum(rate * 100, 2)}
                  onFocus={() => setRateEdit(String(fmtNum(rate * 100, 2)))}
                  onChangeText={setRateEdit}
                  onBlur={commitRate}
                  onSubmitEditing={commitRate}
                />
              </View>
              <View style={{ flex: 1 }} />
            </View>
          </ScrollView>

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
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 24 },
  handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, marginBottom: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  close: { color: theme.colors.textDim, fontSize: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: theme.colors.surfaceAlt, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: 9, paddingHorizontal: 14 },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipTxt: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  chipTxtActive: { color: '#0B0E11' },
  fieldLabel: { color: theme.colors.textDim, fontSize: 12, marginBottom: 6, marginTop: 16 },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchInput: { flex: 1, backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: theme.colors.text, fontSize: 15 },
  searchBtn: { backgroundColor: theme.colors.primary, borderRadius: 8, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', minWidth: 84 },
  searchBtnTxt: { color: '#0B0E11', fontWeight: '700', fontSize: 14 },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  resultSym: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  resultYahoo: { color: theme.colors.textFaint, fontSize: 11, fontWeight: '400' },
  resultName: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  resultClass: { color: theme.colors.primary, fontSize: 11, fontWeight: '600' },
  currentRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 18 },
  currentSym: { color: theme.colors.primary, fontSize: 16, fontWeight: '700' },
  currentName: { color: theme.colors.textDim, fontSize: 12 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  statusInline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusTxt: { color: theme.colors.textDim, fontSize: 12, flexShrink: 1 },
  refresh: { color: theme.colors.primary, fontSize: 13, fontWeight: '600' },
  error: { color: theme.colors.loss, fontSize: 12, marginTop: 8 },
  deltaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  deltaLabel: { color: theme.colors.textDim, fontSize: 12, flexShrink: 1 },
  deltaToggle: { flexDirection: 'row', gap: 6 },
  deltaBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 7, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt },
  deltaBtnActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '22' },
  deltaBtnTxt: { color: theme.colors.textDim, fontSize: 12, fontWeight: '600' },
  deltaBtnTxtActive: { color: theme.colors.primary },
  fieldRow: { flexDirection: 'row', gap: 12 },
  input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: theme.colors.text, fontSize: 15 },
  doneBtn: { backgroundColor: theme.colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  doneTxt: { color: '#0B0E11', fontSize: 15, fontWeight: '700' },
});
