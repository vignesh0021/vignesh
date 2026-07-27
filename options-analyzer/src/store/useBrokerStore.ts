import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import * as delta from '../services/brokers/delta';
import * as fyers from '../services/brokers/fyers';
import type { BrokerPosition } from '../services/brokers/types';

/**
 * Broker connections (read-only). Credentials and tokens are stored on-device
 * only (AsyncStorage) and never leave the phone except in calls to the broker's
 * own API. Fyers uses OAuth (the interactive step runs in the Brokers screen,
 * which then hands the token here); Delta India uses an API key/secret pair.
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

interface DeltaCreds {
  apiKey: string;
  apiSecret: string;
}

interface BrokerState {
  fyers: FyersCreds;
  delta: DeltaCreds;
  positions: BrokerPosition[];
  loading: boolean;
  error: string | null;
  lastFetched: number | null;

  setFyersApp: (appId: string, secret: string) => void;
  setFyersRedirect: (redirectUri: string) => void;
  setFyersToken: (accessToken: string, refreshToken?: string) => void;
  clearFyers: () => void;
  setDelta: (apiKey: string, apiSecret: string) => void;
  clearDelta: () => void;
  refresh: () => Promise<void>;
}

export const useBrokerStore = create<BrokerState>()(
  persist(
    (set, get) => ({
      fyers: { appId: '', secret: '', redirectUri: DEFAULT_FYERS_REDIRECT },
      delta: { apiKey: '', apiSecret: '' },
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
      setDelta: (apiKey, apiSecret) => set({ delta: { apiKey, apiSecret } }),
      clearDelta: () => set({ delta: { apiKey: '', apiSecret: '' } }),

      refresh: async () => {
        const { fyers: f } = get();
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
      partialize: (s) => ({ fyers: s.fyers, delta: s.delta }),
    },
  ),
);
