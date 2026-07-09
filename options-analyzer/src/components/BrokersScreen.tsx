import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { buildAuthUrl, exchangeCode, parseAuthCode } from '../services/brokers/fyers';
import { verify as deltaVerify } from '../services/brokers/delta';
import type { BrokerPosition } from '../services/brokers/types';
import { theme } from '../theme';
import { DEFAULT_FYERS_REDIRECT, useBrokerStore } from '../store/useBrokerStore';
import { fmtNum } from '../utils/format';

WebBrowser.maybeCompleteAuthSession();

/**
 * Brokers: connect Fyers (OAuth2) and Delta India (API key/secret) read-only
 * to monitor your real positions & live PnL. Credentials stay on-device.
 */
export function BrokersScreen() {
  const fyers = useBrokerStore((s) => s.fyers);
  const delta = useBrokerStore((s) => s.delta);
  const positions = useBrokerStore((s) => s.positions);
  const loading = useBrokerStore((s) => s.loading);
  const error = useBrokerStore((s) => s.error);
  const lastFetched = useBrokerStore((s) => s.lastFetched);

  const setFyersApp = useBrokerStore((s) => s.setFyersApp);
  const setFyersRedirect = useBrokerStore((s) => s.setFyersRedirect);
  const setFyersToken = useBrokerStore((s) => s.setFyersToken);
  const clearFyers = useBrokerStore((s) => s.clearFyers);
  const setDelta = useBrokerStore((s) => s.setDelta);
  const clearDelta = useBrokerStore((s) => s.clearDelta);
  const refresh = useBrokerStore((s) => s.refresh);

  const [appId, setAppId] = useState(fyers.appId);
  const [secret, setSecret] = useState(fyers.secret);
  const [redirectUri, setRedirectUri] = useState(fyers.redirectUri || DEFAULT_FYERS_REDIRECT);
  const [pastedCode, setPastedCode] = useState('');
  const [dKey, setDKey] = useState(delta.apiKey);
  const [dSecret, setDSecret] = useState(delta.apiSecret);
  const [busy, setBusy] = useState<string | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const fyersConnected = !!fyers.accessToken;
  const deltaConnected = !!delta.apiKey && !!delta.apiSecret;

  // Step 1 — open the Fyers login page in the browser.
  const onOpenFyersLogin = async () => {
    setLocalErr(null);
    if (!appId || !secret) {
      setLocalErr('Enter your Fyers App ID and Secret first.');
      return;
    }
    if (!/^https?:\/\//i.test(redirectUri)) {
      setLocalErr('Redirect URI must be an https URL (Fyers rejects app:// schemes).');
      return;
    }
    setFyersApp(appId, secret);
    setFyersRedirect(redirectUri);
    setBusy('fyers');
    try {
      await WebBrowser.openBrowserAsync(buildAuthUrl(appId, redirectUri));
    } catch (e) {
      setLocalErr(`Couldn't open the login page: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  // Step 2 — user pastes the redirected URL (or bare auth_code); exchange it.
  const onSubmitCode = async () => {
    setLocalErr(null);
    if (!appId || !secret) {
      setLocalErr('Enter your Fyers App ID and Secret first.');
      return;
    }
    const code = parseAuthCode(pastedCode);
    if (!code) {
      setLocalErr('Paste the full redirect URL (contains auth_code=…) or the auth code itself.');
      return;
    }
    setBusy('fyers-code');
    try {
      const { accessToken, refreshToken } = await exchangeCode(appId, secret, code);
      setFyersToken(accessToken, refreshToken);
      setPastedCode('');
      await refresh();
    } catch (e) {
      setLocalErr(`Fyers token exchange failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onDeltaConnect = async () => {
    setLocalErr(null);
    if (!dKey || !dSecret) {
      setLocalErr('Enter your Delta API key and secret.');
      return;
    }
    setBusy('delta');
    try {
      await deltaVerify(dKey, dSecret);
      setDelta(dKey, dSecret);
      await refresh();
    } catch (e) {
      setLocalErr(`Delta connect failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const totalPnl = positions.reduce((a, p) => a + p.pnl, 0);
  const updated = lastFetched ? new Date(lastFetched).toLocaleTimeString() : '—';

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.intro}>
        Connect your brokers to monitor real positions & live PnL. Read-only. Keys are stored only on
        this device.
      </Text>

      {/* Fyers */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.brokerName}>Fyers <Text style={styles.market}>· Indian market</Text></Text>
          <Text style={[styles.badge, fyersConnected ? styles.badgeOn : styles.badgeOff]}>
            {fyersConnected ? 'Connected' : 'Not connected'}
          </Text>
        </View>
        <Text style={styles.fieldLabel}>App ID (client_id)</Text>
        <TextInput style={styles.input} value={appId} onChangeText={setAppId} autoCapitalize="none" placeholder="XXXXXX-100" placeholderTextColor={theme.colors.textFaint} />
        <Text style={styles.fieldLabel}>Secret ID</Text>
        <TextInput style={styles.input} value={secret} onChangeText={setSecret} autoCapitalize="none" secureTextEntry placeholder="secret key" placeholderTextColor={theme.colors.textFaint} />

        <Text style={styles.fieldLabel}>Redirect URI (https)</Text>
        <TextInput
          style={styles.input}
          value={redirectUri}
          onChangeText={setRedirectUri}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://127.0.0.1/"
          placeholderTextColor={theme.colors.textFaint}
        />
        <Text style={styles.redirectNote}>
          Paste this <Text style={styles.redirectUri}>exact</Text> URL as the Redirect URI when creating your
          Fyers API app. Fyers only accepts an <Text style={styles.redirectUri}>https://</Text> URL — a{' '}
          <Text style={styles.redirectUri}>tradelikehunter://</Text> scheme is rejected. Also tick the{' '}
          <Text style={styles.redirectUri}>Quotes & Market data</Text> permission.
        </Text>

        <View style={styles.stepRow}>
          <Text style={styles.stepBadge}>1</Text>
          <Text style={styles.stepTxt}>Open the Fyers login, sign in, and approve.</Text>
        </View>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onOpenFyersLogin} disabled={busy === 'fyers'}>
          {busy === 'fyers' ? <ActivityIndicator color="#0B0E11" /> : <Text style={styles.btnPrimaryTxt}>{fyersConnected ? 'Re-login with Fyers' : 'Open Fyers Login'}</Text>}
        </TouchableOpacity>

        <View style={[styles.stepRow, { marginTop: 14 }]}>
          <Text style={styles.stepBadge}>2</Text>
          <Text style={styles.stepTxt}>
            After approving you land on the redirect URL. Copy that whole URL from the address bar and paste it
            here (it contains <Text style={styles.redirectUri}>auth_code=…</Text>).
          </Text>
        </View>
        <TextInput
          style={styles.input}
          value={pastedCode}
          onChangeText={setPastedCode}
          autoCapitalize="none"
          placeholder="https://127.0.0.1/?auth_code=…  (or just the code)"
          placeholderTextColor={theme.colors.textFaint}
        />
        <View style={styles.btnRow}>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onSubmitCode} disabled={busy === 'fyers-code'}>
            {busy === 'fyers-code' ? <ActivityIndicator color="#0B0E11" /> : <Text style={styles.btnPrimaryTxt}>Connect Fyers</Text>}
          </TouchableOpacity>
          {fyersConnected ? (
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={clearFyers}>
              <Text style={styles.btnOutlineTxt}>Disconnect</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Delta */}
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.brokerName}>Delta Exchange India <Text style={styles.market}>· Crypto</Text></Text>
          <Text style={[styles.badge, deltaConnected ? styles.badgeOn : styles.badgeOff]}>
            {deltaConnected ? 'Connected' : 'Not connected'}
          </Text>
        </View>
        <Text style={styles.fieldLabel}>API Key</Text>
        <TextInput style={styles.input} value={dKey} onChangeText={setDKey} autoCapitalize="none" placeholder="api key" placeholderTextColor={theme.colors.textFaint} />
        <Text style={styles.fieldLabel}>API Secret</Text>
        <TextInput style={styles.input} value={dSecret} onChangeText={setDSecret} autoCapitalize="none" secureTextEntry placeholder="api secret" placeholderTextColor={theme.colors.textFaint} />
        <Text style={styles.redirectNote}>Create a read-only API key at Delta → Settings → API Keys.</Text>
        <View style={styles.btnRow}>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onDeltaConnect} disabled={busy === 'delta'}>
            {busy === 'delta' ? <ActivityIndicator color="#0B0E11" /> : <Text style={styles.btnPrimaryTxt}>{deltaConnected ? 'Reconnect' : 'Connect Delta'}</Text>}
          </TouchableOpacity>
          {deltaConnected ? (
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={clearDelta}>
              <Text style={styles.btnOutlineTxt}>Disconnect</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {localErr ? <Text style={styles.err}>{localErr}</Text> : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}

      {/* Live positions */}
      {fyersConnected || deltaConnected ? (
        <View style={styles.posBlock}>
          <View style={styles.posHead}>
            <Text style={styles.posTitle}>Live Positions ({positions.length})</Text>
            <TouchableOpacity onPress={refresh} hitSlop={8}>
              <Text style={styles.refresh}>{loading ? 'refreshing…' : '↻ Refresh'}</Text>
            </TouchableOpacity>
          </View>
          {positions.length > 0 ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total UPNL · updated {updated}</Text>
              <Text style={[styles.totalVal, { color: totalPnl >= 0 ? theme.colors.profit : theme.colors.loss }]}>
                {totalPnl >= 0 ? '+' : ''}{fmtNum(totalPnl, 2)}
              </Text>
            </View>
          ) : (
            <Text style={styles.empty}>{loading ? 'Loading…' : 'No open positions returned.'}</Text>
          )}
          {positions.map((p, i) => (
            <PositionCard key={`${p.broker}-${p.symbol}-${i}`} p={p} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function PositionCard({ p }: { p: BrokerPosition }) {
  const short = p.qty < 0;
  return (
    <View style={styles.pos}>
      <View style={styles.posCardHead}>
        <View style={[styles.bar, { backgroundColor: short ? theme.colors.sell : theme.colors.buy }]} />
        <Text style={styles.posSym}>{p.symbol}</Text>
        <Text style={styles.brokerTag}>{p.broker.toUpperCase()}</Text>
      </View>
      <View style={styles.posMetrics}>
        <Metric label="Qty" value={`${p.qty > 0 ? '+' : ''}${fmtNum(p.qty, 0)}`} />
        <Metric label="Avg" value={fmtNum(p.avgPrice, 1)} center />
        <Metric label="LTP" value={p.ltp > 0 ? fmtNum(p.ltp, 1) : '—'} center />
        <Metric label="PnL" value={`${p.pnl >= 0 ? '+' : ''}${fmtNum(p.pnl, 2)}`} color={p.pnl >= 0 ? theme.colors.profit : theme.colors.loss} right />
      </View>
    </View>
  );
}

function Metric({ label, value, color, center, right }: { label: string; value: string; color?: string; center?: boolean; right?: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: right ? 'flex-end' : center ? 'center' : 'flex-start' }}>
      <Text style={styles.mLabel}>{label}</Text>
      <Text style={[styles.mVal, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.bg },
  intro: { color: theme.colors.textDim, fontSize: 12, lineHeight: 18, margin: 12 },
  card: { backgroundColor: theme.colors.surface, marginHorizontal: 12, marginBottom: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, padding: 14 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  brokerName: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  market: { color: theme.colors.textDim, fontSize: 12, fontWeight: '400' },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  badgeOn: { color: theme.colors.profit, backgroundColor: theme.colors.profit + '22' },
  badgeOff: { color: theme.colors.textDim, backgroundColor: theme.colors.surfaceAlt },
  fieldLabel: { color: theme.colors.textDim, fontSize: 12, marginBottom: 5, marginTop: 8 },
  input: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: theme.colors.text, fontSize: 14 },
  redirectNote: { color: theme.colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: 10 },
  redirectUri: { color: theme.colors.primary, fontSize: 12, fontWeight: '600' },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12, marginBottom: 8 },
  stepBadge: { color: '#0B0E11', backgroundColor: theme.colors.primary, width: 18, height: 18, borderRadius: 9, textAlign: 'center', fontSize: 11, fontWeight: '800', overflow: 'hidden', lineHeight: 18 },
  stepTxt: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17, flex: 1 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: theme.colors.primary },
  btnPrimaryTxt: { color: '#0B0E11', fontWeight: '700', fontSize: 14 },
  btnOutline: { borderWidth: 1, borderColor: theme.colors.border },
  btnOutlineTxt: { color: theme.colors.text, fontWeight: '600', fontSize: 14 },
  err: { color: theme.colors.loss, fontSize: 12, marginHorizontal: 12, marginBottom: 8, lineHeight: 17 },
  posBlock: { marginTop: 6 },
  posHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 12, marginBottom: 8 },
  posTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  refresh: { color: theme.colors.primary, fontSize: 13, fontWeight: '600' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 12, marginBottom: 10 },
  totalLabel: { color: theme.colors.textDim, fontSize: 12 },
  totalVal: { fontSize: 16, fontWeight: '700' },
  empty: { color: theme.colors.textFaint, fontSize: 13, marginHorizontal: 12, marginBottom: 10 },
  pos: { backgroundColor: theme.colors.surface, marginHorizontal: 12, marginBottom: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 12 },
  posCardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bar: { width: 4, height: 16, borderRadius: 2 },
  posSym: { color: theme.colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
  brokerTag: { color: theme.colors.textFaint, fontSize: 10, fontWeight: '700' },
  posMetrics: { flexDirection: 'row', marginTop: 10 },
  mLabel: { color: theme.colors.textDim, fontSize: 11, marginBottom: 3 },
  mVal: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
});
