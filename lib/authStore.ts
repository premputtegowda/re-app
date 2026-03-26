'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, getTokens, clearTokens, refreshAccessToken } from './api';

// Background token refresh — runs every 4 minutes, refreshes if expiring within 60s
let _refreshTimer: ReturnType<typeof setInterval> | null = null;

export function startTokenRefreshTimer() {
  if (_refreshTimer) return;
  _refreshTimer = setInterval(async () => {
    const { refreshToken, accessTokenExpiresAt } = getTokens();
    if (!refreshToken || !accessTokenExpiresAt) return;
    const expiresInMs = accessTokenExpiresAt - Date.now();
    if (expiresInMs < 60_000) {
      await refreshAccessToken();
    }
  }, 4 * 60 * 1000); // check every 4 minutes
}

export function stopTokenRefreshTimer() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture_url: string | null;
  is_admin: boolean;
  has_complimentary_access: boolean;
  features: string[];
}

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,

      login: async (credential: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.googleLogin(credential);
          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
          });
          startTokenRefreshTimer();
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Login failed',
            isLoading: false,
          });
          throw error;
        }
      },

      logout: async () => {
        stopTokenRefreshTimer();
        set({ isLoading: true });
        try {
          await api.logout();
        } finally {
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
          });
        }
      },

      checkAuth: async () => {
        const { accessToken } = getTokens();
        if (!accessToken) {
          set({ isAuthenticated: false, isLoading: false, user: null });
          return;
        }

        set({ isLoading: true });
        try {
          const user = await api.getCurrentUser();
          if (user) {
            set({ user, isAuthenticated: true, isLoading: false });
            startTokenRefreshTimer();
          } else {
            // getCurrentUser returned null — explicit 401, tokens already cleared
            set({ user: null, isAuthenticated: false, isLoading: false });
          }
        } catch (err) {
          // Network error or server error — keep the user logged in, don't clear tokens
          // They may just be offline or the backend is temporarily down
          const isAuthError = err instanceof Error && err.message.includes('401');
          if (isAuthError) {
            clearTokens();
            set({ user: null, isAuthenticated: false, isLoading: false });
          } else {
            // Preserve existing auth state — don't log the user out
            set({ isLoading: false });
            startTokenRefreshTimer();
          }
        }
      },

      setUser: (user) => set({ user, isAuthenticated: !!user }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
    }),
    {
      name: 'reps-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
