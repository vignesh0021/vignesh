import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { theme } from '../theme';
import type { OptionAction, OptionPosition, OptionType, PositionStatus } from '../types';
import { usePortfolioStore, type NewPositionInput } from '../store/usePortfolioStore';
import { addDaysIso, daysBetween, fmtDateShort, todayIso } from '../utils/format';
import { CalendarPicker } from './CalendarPicker';

interface Props {
  visible: boolean;
  editing: OptionPosition | null;
  onClose: () => void;
}

interface FormState {
  instrument: string;
  type: OptionType;
  action: OptionAction;
  strike: string;
  expiry: string; // ISO
  entryPremium: string;
  exitPremium: string;
  status: PositionStatus;
  lots: string;
  lotSize: string;
  iv: string; // percent
}

/** Slide-up sheet to Add / Edit / Close / Delete a leg. */
export function PositionSheet({ visible, editing, onClose }: Props) {
  const asset = usePortfolioStore((s) => s.asset);
  const instrument = asset.symbol;
  const defaultIv = usePortfolioStore((s) => s.defaultIv);
  const addPosition = usePortfolioStore((s) => s.addPosition);
  const updatePosition = usePortfolioStore((s) => s.updatePosition);
  const removePosition = usePortfolioStore((s) => s.removePosition);
  const closePosition = usePortfolioStore((s) => s.closePosition);
  const updateExitPremium = usePortfolioStore((s) => s.updateExitPremium);
  const reopenPosition = usePortfolioStore((s) => s.reopenPosition);

  const emptyForm = (): FormState => ({
    instrument,
    type: 'CALL',
    action: 'BUY',
    strike: '',
    expiry: addDaysIso(todayIso(), 30),
    entryPremium: '',
    exitPremium: '',
    status: 'OPEN',
    lots: '1',
    lotSize: String(asset.lotSize),
    iv: String(Math.round(defaultIv * 100)),
  });

  const [form, setForm] = useState<FormState>(emptyForm());
  const [calOpen, setCalOpen] = useState(false);

  useEffect(() => {
    if (editing) {
      setForm({
        instrument: editing.instrument,
        type: editing.type,
        action: editing.action,
        strike: String(editing.strike),
        expiry: editing.expiry,
        entryPremium: String(editing.entryPremium),
        exitPremium: editing.exitPremium != null ? String(editing.exitPremium) : '',
        status: editing.status,
        lots: String(editing.lots),
        lotSize: String(editing.lotSize),
        iv: String(Math.max(Math.round(editing.iv * 100), 1)),
      });
    } else {
      setForm(emptyForm());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, visible]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const daysToExpiry = Math.max(Math.round(daysBetween(todayIso(), form.expiry)), 0);

  const onSubmit = () => {
    // IV is always clamped positive so Greeks never collapse to zero.
    const base: NewPositionInput = {
      instrument: form.instrument || instrument,
      type: form.type,
      action: form.action,
      strike: Number(form.strike) || 0,
      expiry: form.expiry,
      entryPremium: Number(form.entryPremium) || 0,
      lots: Number(form.lots) || 1,
      lotSize: Number(form.lotSize) || 1,
      iv: Math.max((Number(form.iv) || 0) / 100, 0.01),
    };

    if (!editing) {
      addPosition(base);
      onClose();
      return;
    }

    const id = editing.id;
    updatePosition(id, base);

    const exit = Number(form.exitPremium) || base.entryPremium;
    const wantClosed = form.status === 'CLOSED';
    const wasClosed = editing.status === 'CLOSED';
    if (wantClosed && !wasClosed) closePosition(id, exit);
    else if (wantClosed && wasClosed) updateExitPremium(id, exit);
    else if (!wantClosed && wasClosed) reopenPosition(id);

    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <Text style={styles.title}>{editing ? 'Edit Contract' : 'Add Contract'}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={10}>
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}>
              <View style={styles.segRow}>
                <Segmented label="Buy / Sell" options={['BUY', 'SELL']} value={form.action} onChange={(v) => set('action', v as OptionAction)} colors={[theme.colors.buy, theme.colors.sell]} />
                <Segmented label="Call / Put" options={['CALL', 'PUT']} value={form.type} onChange={(v) => set('type', v as OptionType)} />
              </View>

              <View style={styles.fieldRow}>
                <Field label="Instrument" value={form.instrument} onChangeText={(v) => set('instrument', v)} autoCapitalize="characters" />
                <Field label="Strike" value={form.strike} onChangeText={(v) => set('strike', v)} keyboardType="numeric" />
              </View>

              {/* Expiry via calendar */}
              <Text style={styles.fieldLabel}>Expiry</Text>
              <TouchableOpacity style={styles.dateBtn} onPress={() => setCalOpen(true)}>
                <Text style={styles.dateTxt}>📅  {fmtDateShort(form.expiry)}</Text>
                <Text style={styles.dateSub}>{daysToExpiry} days to expiry</Text>
              </TouchableOpacity>

              <View style={styles.fieldRow}>
                <Field label="Entry Premium" value={form.entryPremium} onChangeText={(v) => set('entryPremium', v)} keyboardType="numeric" />
                <Field label="IV (%)" value={form.iv} onChangeText={(v) => set('iv', v)} keyboardType="numeric" />
              </View>

              <View style={styles.fieldRow}>
                <Field label="Lots" value={form.lots} onChangeText={(v) => set('lots', v)} keyboardType="numeric" />
                <Field label="Lot Size" value={form.lotSize} onChangeText={(v) => set('lotSize', v)} keyboardType="numeric" />
              </View>

              {/* Close controls only when editing an existing leg */}
              {editing ? (
                <View style={styles.closeBlock}>
                  <View style={styles.segRow}>
                    <Segmented label="Position Status" options={['OPEN', 'CLOSED']} value={form.status} onChange={(v) => set('status', v as PositionStatus)} colors={[theme.colors.profit, theme.colors.textDim]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Exit / Close Price</Text>
                      <TextInput
                        style={[styles.input, form.status !== 'CLOSED' && styles.inputDisabled]}
                        value={form.exitPremium}
                        onChangeText={(v) => set('exitPremium', v)}
                        keyboardType="numeric"
                        editable={form.status === 'CLOSED'}
                        placeholder="exit premium"
                        placeholderTextColor={theme.colors.textFaint}
                      />
                    </View>
                  </View>
                  {form.status === 'CLOSED' ? (
                    <Text style={styles.closeHint}>
                      Closing freezes realized PNL and zeroes this leg's Greeks; the payoff keeps its
                      banked PNL as a baseline offset.
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.actions}>
              {editing ? (
                <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => { removePosition(editing.id); onClose(); }}>
                  <Text style={[styles.btnTxt, { color: theme.colors.primary }]}>🗑  Delete</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onSubmit}>
                <Text style={[styles.btnTxt, { color: '#0B0E11' }]}>{editing ? 'Update' : 'Add Position'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>

      <CalendarPicker
        visible={calOpen}
        valueIso={form.expiry}
        onSelect={(iso) => set('expiry', iso)}
        onClose={() => setCalOpen(false)}
      />
    </Modal>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
  colors,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  colors?: string[];
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.segmented}>
        {options.map((opt, i) => {
          const active = opt === value;
          const activeColor = colors?.[i] ?? theme.colors.primary;
          return (
            <TouchableOpacity
              key={opt}
              style={[styles.segBtn, active && { backgroundColor: activeColor + '22', borderColor: activeColor }]}
              onPress={() => onChange(opt)}
            >
              <Text style={[styles.segTxt, active && { color: activeColor, fontWeight: '700' }]}>
                {opt[0] + opt.slice(1).toLowerCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: 'numeric' | 'default';
  autoCapitalize?: 'characters' | 'none';
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        placeholderTextColor={theme.colors.textFaint}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  backdropTap: { flex: 1 },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingBottom: 28, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, marginBottom: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  close: { color: theme.colors.textDim, fontSize: 18 },
  segRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  fieldRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  fieldLabel: { color: theme.colors.textDim, fontSize: 12, marginBottom: 6, marginTop: 14 },
  segmented: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', backgroundColor: theme.colors.surfaceAlt },
  segTxt: { color: theme.colors.textDim, fontSize: 13 },
  input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: theme.colors.text, fontSize: 15 },
  inputDisabled: { opacity: 0.4 },
  dateBtn: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateTxt: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  dateSub: { color: theme.colors.textDim, fontSize: 12 },
  closeBlock: { marginTop: 4 },
  closeHint: { color: theme.colors.textFaint, fontSize: 12, marginTop: 10, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  btnPrimary: { backgroundColor: theme.colors.primary },
  btnOutline: { borderWidth: 1, borderColor: theme.colors.primary },
  btnTxt: { fontSize: 15, fontWeight: '700' },
});
