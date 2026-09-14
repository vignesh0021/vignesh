import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../theme';
import type { TabItem } from './TabGrid';

/**
 * Kite/Dhan-style bottom navigation: 4 fixed primary slots + a "More" slot that
 * opens a full row-list sheet for the overflow sections. The selected section
 * owns the whole screen above the bar; the active slot is tinted with the brand
 * red and carries a 2dp top indicator.
 */
export function BottomTabBar({
  primary,
  more,
  active,
  onSelect,
}: {
  primary: TabItem[];
  more: TabItem[];
  active: string;
  onSelect: (key: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = more.some((m) => m.key === active);

  const Slot = ({ item, isActive, onPress }: { item: TabItem; isActive: boolean; onPress: () => void }) => (
    <TouchableOpacity style={styles.slot} onPress={onPress} activeOpacity={0.7}>
      {isActive ? <View style={styles.indicator} /> : null}
      <Text style={[styles.icon, isActive && { opacity: 1 }]}>{item.icon}</Text>
      <Text style={[styles.label, isActive && styles.labelOn]} numberOfLines={1}>
        {item.label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      {primary.map((item) => (
        <Slot key={item.key} item={item} isActive={item.key === active} onPress={() => onSelect(item.key)} />
      ))}
      <Slot item={{ key: 'MORE', label: 'More', icon: '⋯' }} isActive={moreActive} onPress={() => setMoreOpen(true)} />

      <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMoreOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>More</Text>
          {more.map((item) => {
            const on = item.key === active;
            return (
              <TouchableOpacity
                key={item.key}
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => {
                  onSelect(item.key);
                  setMoreOpen(false);
                }}
              >
                <Text style={styles.rowIcon}>{item.icon}</Text>
                <Text style={[styles.rowLabel, on && { color: theme.colors.primary }]}>{item.label}</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 6,
  },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  indicator: { position: 'absolute', top: -6, height: 2, width: 28, borderRadius: 2, backgroundColor: theme.colors.primary },
  icon: { fontSize: 19, opacity: 0.85, marginBottom: 3 },
  label: { color: theme.colors.textFaint, fontSize: 10, fontWeight: '700' },
  labelOn: { color: theme.colors.primary },
  backdrop: { flex: 1, backgroundColor: '#000000CC' },
  sheet: {
    backgroundColor: theme.colors.surfaceAlt,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, marginVertical: 10 },
  sheetTitle: { color: theme.colors.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  rowIcon: { fontSize: 18, width: 26, textAlign: 'center' },
  rowLabel: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  chevron: { color: theme.colors.textFaint, fontSize: 20, fontWeight: '400' },
});
