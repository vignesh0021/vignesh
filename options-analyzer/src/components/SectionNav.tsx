import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { theme } from '../theme';
import type { TabItem } from './TabGrid';
import { TabGrid } from './TabGrid';

/**
 * Collapsible section navigation. Normally just a slim bar showing the current
 * section (icon + label) so the content below runs full-screen. Tapping it
 * opens a grid of glowing boxes to switch; picking one collapses it again.
 * This replaces the always-on tab grids that were eating half the viewport.
 */
export function SectionNav({
  items,
  active,
  onSelect,
  columns = 3,
}: {
  items: TabItem[];
  active: string;
  onSelect: (key: string) => void;
  columns?: number;
}) {
  const [open, setOpen] = useState(false);
  const cur = items.find((i) => i.key === active) ?? items[0];

  return (
    <>
      <TouchableOpacity style={styles.bar} activeOpacity={0.8} onPress={() => setOpen(true)}>
        <Text style={styles.icon}>{cur.icon}</Text>
        <Text style={styles.label} numberOfLines={1}>
          {cur.label}
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.menu}>▾ Menu</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <TabGrid
            columns={columns}
            items={items}
            active={active}
            onSelect={(k) => {
              onSelect(k);
              setOpen(false);
            }}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginVertical: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    // red glow
    shadowColor: theme.colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  icon: { fontSize: 16 },
  label: { color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  menu: { color: theme.colors.primary, fontSize: 12, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: '#000000CC' },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 22,
    paddingTop: 6,
    borderTopWidth: 1,
    borderColor: theme.colors.border,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, marginVertical: 10 },
});
