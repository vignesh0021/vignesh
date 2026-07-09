import React, { useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { buildChain, type ChainQuote, type ChainRow } from '../services/optionChain';
import { theme } from '../theme';
import { fmtNum } from '../utils/format';

/**
 * Market-Pulse-style one-screen option chain: Call LTP · STRIKE · Put LTP with
 * OI columns on the outer edges. Tap any call or put cell to open the order
 * ticket for that strike — "pick a strike and trade" in one glance.
 */
export function OptionChain({
  underlying,
  spot,
  refSpot,
  iv,
  rate,
  step,
  expiryIso,
  strikesEachSide = 12,
  onSelect,
}: {
  underlying: string;
  spot: number;
  refSpot: number;
  iv: number;
  rate: number;
  step: number;
  expiryIso: string;
  strikesEachSide?: number;
  onSelect: (quote: ChainQuote, strike: number) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);

  const { rows, atm } = useMemo(
    () => buildChain({ underlying, spot, refSpot, iv, rate, expiryIso, step, strikesEachSide }),
    [underlying, spot, refSpot, iv, rate, expiryIso, step, strikesEachSide],
  );

  return (
    <View style={styles.wrap}>
      {/* Column header */}
      <View style={styles.headerRow}>
        <Text style={[styles.hCell, styles.hOi]}>OI(L)</Text>
        <Text style={[styles.hCell, styles.hLtp]}>CALL LTP</Text>
        <Text style={[styles.hCell, styles.hStrike]}>STRIKE</Text>
        <Text style={[styles.hCell, styles.hLtp]}>PUT LTP</Text>
        <Text style={[styles.hCell, styles.hOi]}>OI(L)</Text>
      </View>

      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        {rows.map((row) => (
          <Row key={row.strike} row={row} atmStrike={atm} onSelect={onSelect} />
        ))}
      </ScrollView>
    </View>
  );
}

function Row({
  row,
  atmStrike,
  onSelect,
}: {
  row: ChainRow;
  atmStrike: number;
  onSelect: (quote: ChainQuote, strike: number) => void;
}) {
  const isAtm = row.strike === atmStrike;
  return (
    <View style={[styles.row, isAtm && styles.rowAtm]}>
      {/* Call side */}
      <TouchableOpacity
        style={styles.side}
        activeOpacity={0.7}
        onPress={() => onSelect(row.call, row.strike)}
      >
        <View style={styles.oiCol}>
          <Text style={styles.oiTxt}>{fmtNum(row.call.oiLacs, 2)}</Text>
        </View>
        <LtpChip quote={row.call} align="flex-end" itmSide={row.call.itm} />
      </TouchableOpacity>

      {/* Strike */}
      <View style={styles.strikeCol}>
        <Text style={[styles.strikeTxt, isAtm && styles.strikeAtm]}>{fmtNum(row.strike, 0)}</Text>
        {isAtm ? <Text style={styles.atmTag}>ATM</Text> : null}
      </View>

      {/* Put side */}
      <TouchableOpacity
        style={styles.side}
        activeOpacity={0.7}
        onPress={() => onSelect(row.put, row.strike)}
      >
        <LtpChip quote={row.put} align="flex-start" itmSide={row.put.itm} />
        <View style={styles.oiCol}>
          <Text style={styles.oiTxt}>{fmtNum(row.put.oiLacs, 2)}</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

function LtpChip({ quote, align, itmSide }: { quote: ChainQuote; align: 'flex-start' | 'flex-end'; itmSide: boolean }) {
  const up = quote.chg >= 0;
  const color = up ? theme.colors.profit : theme.colors.loss;
  return (
    <View style={[styles.ltpCol, { alignItems: align }]}>
      <View style={[styles.chip, { backgroundColor: color + (itmSide ? '2E' : '18') }]}>
        <Text style={[styles.ltpTxt, { color }]}>{fmtNum(quote.ltp, 2)}</Text>
      </View>
      <Text style={[styles.chgTxt, { color }]}>
        {up ? '+' : ''}
        {fmtNum(quote.chg, 2)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  hCell: { color: theme.colors.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  hOi: { flex: 1, textAlign: 'center' },
  hLtp: { flex: 1.5, textAlign: 'center' },
  hStrike: { flex: 1.4, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  rowAtm: { backgroundColor: theme.colors.surfaceAlt },
  side: { flex: 2.5, flexDirection: 'row', alignItems: 'center' },
  oiCol: { flex: 1, alignItems: 'center' },
  oiTxt: { color: theme.colors.textDim, fontSize: 11 },
  ltpCol: { flex: 1.5, justifyContent: 'center' },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, minWidth: 58, alignItems: 'center' },
  ltpTxt: { fontSize: 13, fontWeight: '700' },
  chgTxt: { fontSize: 10, marginTop: 2 },
  strikeCol: { flex: 1.4, alignItems: 'center' },
  strikeTxt: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  strikeAtm: { color: theme.colors.primary },
  atmTag: { color: theme.colors.primary, fontSize: 8, fontWeight: '800', marginTop: 1 },
});
