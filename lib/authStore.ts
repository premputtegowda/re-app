'use client';

import { create } from 'zustand';
import { api, refreshAccessToken, clearAccessToken } from './api';

// Background token refresh — runs every 4 minutes, silently refreshes via cookie
// if the in-memory access token is expiring within 60 seconds.
let _refreshTimer: ReturnType<typeof setInterval> | null = null;

export function startTokenRefreshTimer() {
  if (_refreshTimer) return;
  _refreshTimer = setInterval(async () => {
    await refreshAccessToken();
  }, 4 * 60 * 1000);
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

export const useAuthStore = create<AuthStore>()((set) => ({
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
    set({ isLoading: true });
    try {
      // Try to get the current user. authFetch will silently attempt a cookie-based
      // token refresh if the in-memory access token is missing or expiring.
      const user = await api.getCurrentUser();
      if (user) {
        set({ user, isAuthenticated: true, isLoading: false });
        startTokenRefreshTimer();
      } else {
        // Refresh cookie invalid or expired — user must log in again
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    } catch (err) {
      const isAuthError = err instanceof Error && err.message.includes('401');
      if (isAuthError) {
        clearAccessToken();
        set({ user: null, isAuthenticated: false, isLoading: false });
      } else {
        // Network error — preserve existing state (user may be offline)
        set({ isLoading: false });
        startTokenRefreshTimer();
      }
    }
  },

  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
