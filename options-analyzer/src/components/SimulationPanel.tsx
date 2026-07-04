import Slider from '@react-native-community/slider';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { theme } from '../theme';
import { usePortfolioStore } from '../store/usePortfolioStore';
import { addDaysIso, daysBetween, fmtDateShort, fmtNum, todayIso } from '../utils/format';

/**
 * Module 3 — Simulation Control Panel.
 * Spot slider (morph T+0), Target-date slider (time decay), IV slider (Vega).
 */
export function SimulationPanel() {
  const spotPrice = usePortfolioStore((s) => s.spotPrice);
  const targetSpot = usePortfolioStore((s) => s.targetSpot);
  const setTargetSpot = usePortfolioStore((s) => s.setTargetSpot);
  const resetTargetSpot = usePortfolioStore((s) => s.resetTargetSpot);

  const targetDate = usePortfolioStore((s) => s.targetDate);
  const setTargetDate = usePortfolioStore((s) => s.setTargetDate);
  const resetTargetDate = usePortfolioStore((s) => s.resetTargetDate);

  const ivShift = usePortfolioStore((s) => s.ivShift);
  const setIvShift = usePortfolioStore((s) => s.setIvShift);

  const open = usePortfolioStore((s) => s.openPositions);

  // Furthest expiry drives the date slider range.
  const today = todayIso();
  const maxExpiry = open.reduce<string>((acc, p) => (p.expiry > acc ? p.expiry : acc), today);
  const totalDays = Math.max(Math.round(daysBetween(today, maxExpiry)), 1);
  const daysForward = Math.max(Math.round(daysBetween(today, targetDate)), 0);
  const daysToExpiry = Math.max(totalDays - daysForward, 0);

  const spotMin = spotPrice * 0.6;
  const spotMax = spotPrice * 1.6;

  return (
    <View style={styles.wrap}>
      {/* Spot */}
      <Row
        label="Target Price"
        value={fmtNum(targetSpot, 0)}
        onReset={resetTargetSpot}
      />
      <Slider
        style={styles.slider}
        minimumValue={spotMin}
        maximumValue={spotMax}
        value={targetSpot}
        onValueChange={setTargetSpot}
        minimumTrackTintColor={theme.colors.primary}
        maximumTrackTintColor={theme.colors.border}
        thumbTintColor={theme.colors.primary}
      />

      {/* Target date */}
      <Row
        label="Target Date"
        value={fmtDateShort(targetDate)}
        sub={`${daysToExpiry} days to Expiry`}
        onReset={resetTargetDate}
      />
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={totalDays}
        step={1}
        value={daysForward}
        onValueChange={(d) => setTargetDate(addDaysIso(today, d))}
        minimumTrackTintColor={theme.colors.primary}
        maximumTrackTintColor={theme.colors.border}
        thumbTintColor={theme.colors.primary}
      />

      {/* IV */}
      <Row
        label="Implied Volatility Shift"
        value={`${ivShift >= 0 ? '+' : ''}${fmtNum(ivShift * 100, 1)}%`}
        onReset={() => setIvShift(0)}
      />
      <Slider
        style={styles.slider}
        minimumValue={-0.5}
        maximumValue={0.5}
        step={0.01}
        value={ivShift}
        onValueChange={setIvShift}
        minimumTrackTintColor={theme.colors.primary}
        maximumTrackTintColor={theme.colors.border}
        thumbTintColor={theme.colors.primary}
      />
    </View>
  );
}

function Row({
  label,
  value,
  sub,
  onReset,
}: {
  label: string;
  value: string;
  sub?: string;
  onReset: () => void;
}) {
  return (
    <View style={styles.row}>
      <View>
        <Text style={styles.label}>{label}</Text>
        <TouchableOpacity onPress={onReset} hitSlop={8}>
          <Text style={styles.reset}>↺ Reset</Text>
        </TouchableOpacity>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.value}>{value}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 14,
  },
  label: { color: theme.colors.textDim, fontSize: 14 },
  reset: { color: theme.colors.primary, fontSize: 13, marginTop: 4 },
  value: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  sub: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  slider: { width: '100%', height: 36 },
});
