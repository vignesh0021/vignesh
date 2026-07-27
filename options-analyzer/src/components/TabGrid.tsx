import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { theme } from '../theme';

export interface TabItem {
  key: string;
  label: string;
  icon?: string;
}

/**
 * Tap-to-open tab grid — a wrap of rounded boxes shown all at once (no
 * horizontal scrolling). The active box is filled with the accent colour.
 * Used for the main navigation and the Paper Trade sub-navigation.
 */
export function TabGrid({
  items,
  active,
  onSelect,
  columns = 4,
}: {
  items: TabItem[];
  active: string;
  onSelect: (key: string) => void;
  columns?: number;
}) {
  const basis = `${100 / columns - 2}%`;
  return (
    <View style={styles.grid}>
      {items.map((it) => {
        const on = it.key === active;
        return (
          <TouchableOpacity
            key={it.key}
            style={[styles.box, { flexBasis: basis as any }, on ? styles.boxOn : null]}
            onPress={() => onSelect(it.key)}
            activeOpacity={0.8}
          >
            {it.icon ? <Text style={styles.icon}>{it.icon}</Text> : null}
            <Text style={[styles.label, on ? styles.labelOn : null]} numberOfLines={1}>
              {it.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  box: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  boxOn: {
    backgroundColor: theme.colors.primaryDim,
    borderColor: theme.colors.primary,
  },
  icon: { fontSize: 16, marginBottom: 3 },
  label: { color: theme.colors.textDim, fontSize: 11, fontWeight: '700' },
  labelOn: { color: theme.colors.text },
});
