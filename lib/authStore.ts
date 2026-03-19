'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, getTokens, clearTokens } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
  picture_url: string | null;
  is_admin: boolean;
  has_complimentary_access: boolean;
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
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Login failed',
            isLoading: false,
          });
          throw error;
        }
      },

      logout: async () => {
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
          } else {
            clearTokens();
            set({ user: null, isAuthenticated: false, isLoading: false });
          }
        } catch {
          clearTokens();
          set({ user: null, isAuthenticated: false, isLoading: false });
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
