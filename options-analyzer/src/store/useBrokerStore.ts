import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import * as fyers from '../services/brokers/fyers';
import * as extra from '../services/brokers/indianBrokers';
import type { ExtraBrokerId } from '../services/brokers/indianBrokers';
import type { BrokerPosition } from '../services/brokers/types';

/**
 * Broker connections (read-only). Credentials and tokens are stored on-device
 * only (AsyncStorage) and never leave the phone except in calls to the broker's
 * own API. Fyers uses OAuth (the interactive step runs in the Brokers screen,
 * which then hands the token here). The additional Indian brokers (Dhan,
 * Upstox, Zerodha, Angel One) each store their own creds + session token in the
 * generic `accounts` map and are refreshed alongside Fyers.
 */

interface FyersCreds {
  appId: string;
  secret: string;
  /** https redirect URI registered in the Fyers API app (custom schemes are rejected by Fyers). */
  redirectUri: string;
  accessToken?: string;
  refreshToken?: string;
}

/** Default redirect URI — a valid https URL Fyers accepts; the auth_code is read back from it. */
export const DEFAULT_FYERS_REDIRECT = 'https://127.0.0.1/';

/** A connected extra broker: the creds the user entered plus its session token. */
export interface BrokerAccount {
  creds: Record<string, string>;
  token?: string;
  connectedAt?: number;
}

type Accounts = Partial<Record<ExtraBrokerId, BrokerAccount>>;

interface BrokerState {
  fyers: FyersCreds;
  accounts: Accounts;
  positions: BrokerPosition[];
  loading: boolean;
  error: string | null;
  lastFetched: number | null;

  setFyersApp: (appId: string, secret: string) => void;
  setFyersRedirect: (redirectUri: string) => void;
  setFyersToken: (accessToken: string, refreshToken?: string) => void;
  clearFyers: () => void;
  setBrokerAccount: (id: ExtraBrokerId, account: BrokerAccount) => void;
  clearBrokerAccount: (id: ExtraBrokerId) => void;
  refresh: () => Promise<void>;
}

export const useBrokerStore = create<BrokerState>()(
  persist(
    (set, get) => ({
      fyers: { appId: '', secret: '', redirectUri: DEFAULT_FYERS_REDIRECT },
      accounts: {},
      positions: [],
      loading: false,
      error: null,
      lastFetched: null,

      setFyersApp: (appId, secret) => set((s) => ({ fyers: { ...s.fyers, appId, secret } })),
      setFyersRedirect: (redirectUri) => set((s) => ({ fyers: { ...s.fyers, redirectUri } })),
      setFyersToken: (accessToken, refreshToken) =>
        set((s) => ({ fyers: { ...s.fyers, accessToken, refreshToken } })),
      clearFyers: () =>
        set((s) => ({
          fyers: { appId: s.fyers.appId, secret: s.fyers.secret, redirectUri: s.fyers.redirectUri },
        })),
      setBrokerAccount: (id, account) =>
        set((s) => ({ accounts: { ...s.accounts, [id]: account } })),
      clearBrokerAccount: (id) =>
        set((s) => {
          const next = { ...s.accounts };
          delete next[id];
          return { accounts: next };
        }),

      refresh: async () => {
        const { fyers: f, accounts } = get();
        set({ loading: true, error: null });
        const errors: string[] = [];
        const all: BrokerPosition[] = [];

        if (f.appId && f.accessToken) {
          try {
            all.push(...(await fyers.getPositions(f.appId, f.accessToken)));
          } catch (e) {
            errors.push(`Fyers: ${(e as Error).message}`);
          }
        }

        for (const id of Object.keys(accounts) as ExtraBrokerId[]) {
          const acct = accounts[id];
          if (!acct?.token) continue;
          try {
            all.push(...(await extra.fetchPositions(id, acct.creds, acct.token)));
          } catch (e) {
            errors.push(`${extra.brokerMeta(id).name}: ${(e as Error).message}`);
          }
        }

        set({
          positions: all,
          loading: false,
          lastFetched: Date.now(),
          error: errors.length ? errors.join('  ·  ') : null,
        });
      },
    }),
    {
      name: 'tlh-brokers-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ fyers: s.fyers, accounts: s.accounts }),
    },
  ),
);
