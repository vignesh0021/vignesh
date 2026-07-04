import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { theme } from '../theme';

interface Props {
  visible: boolean;
  /** Currently selected date, ISO yyyy-mm-dd. */
  valueIso: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Lightweight pure-JS month-grid date picker (no native module). */
export function CalendarPicker({ visible, valueIso, onSelect, onClose }: Props) {
  const initial = new Date(valueIso + 'T00:00:00');
  const safe = isNaN(initial.getTime()) ? new Date() : initial;
  const [view, setView] = useState({ y: safe.getFullYear(), m: safe.getMonth() });

  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const todayIso = new Date().toISOString().slice(0, 10);

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const shiftMonth = (delta: number) => {
    let m = view.m + delta;
    let y = view.y;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setView({ y, m });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.card}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => shiftMonth(-1)} hitSlop={10}>
              <Text style={styles.nav}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.title}>
              {MONTHS[view.m]} {view.y}
            </Text>
            <TouchableOpacity onPress={() => shiftMonth(1)} hitSlop={10}>
              <Text style={styles.nav}>›</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((w, i) => (
              <Text key={i} style={styles.weekday}>
                {w}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((d, i) => {
              if (d == null) return <View key={i} style={styles.cell} />;
              const iso = toIso(view.y, view.m, d);
              const selected = iso === valueIso;
              const isToday = iso === todayIso;
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.cell, styles.dayCell, selected && styles.daySelected]}
                  onPress={() => {
                    onSelect(iso);
                    onClose();
                  }}
                >
                  <Text
                    style={[
                      styles.dayTxt,
                      isToday && styles.todayTxt,
                      selected && styles.daySelectedTxt,
                    ]}
                  >
                    {d}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              onPress={() => {
                onSelect(todayIso);
                setView({ y: safe.getFullYear(), m: safe.getMonth() });
              }}
            >
              <Text style={styles.footerBtn}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.footerBtn}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const CELL = 40;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  card: {
    width: CELL * 7 + 24,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  nav: { color: theme.colors.primary, fontSize: 26, paddingHorizontal: 10 },
  title: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  weekRow: { flexDirection: 'row' },
  weekday: { width: CELL, textAlign: 'center', color: theme.colors.textFaint, fontSize: 12, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' },
  dayCell: { borderRadius: CELL / 2 },
  daySelected: { backgroundColor: theme.colors.primary },
  dayTxt: { color: theme.colors.text, fontSize: 14 },
  todayTxt: { color: theme.colors.primary, fontWeight: '700' },
  daySelectedTxt: { color: '#0B0E11', fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 6 },
  footerBtn: { color: theme.colors.primary, fontSize: 15, fontWeight: '600' },
});
