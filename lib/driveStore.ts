'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clearDriveToken } from './driveApi';

export type DrivePermission = 'unknown' | 'granted' | 'denied';

interface DriveStore {
  permission: DrivePermission;
  setPermission: (p: DrivePermission) => void;
  disconnect: () => void;
}

export const useDriveStore = create<DriveStore>()(
  persist(
    (set) => ({
      permission: 'unknown',

      setPermission: (permission) => set({ permission }),

      disconnect: () => {
        clearDriveToken();
        set({ permission: 'denied' });
      },
    }),
    {
      name: 'reps-drive',
    }
  )
);
