'use client';

import { create } from 'zustand';

/**
 * In-memory store for files attached to entries.
 * NOT persisted — File objects can't be serialized to localStorage.
 * Files survive navigation within a session but are cleared on page refresh.
 */
interface AttachmentStore {
  files: Record<string, File[]>; // entryId → files
  addFiles: (entryId: string, newFiles: File[]) => void;
  removeFile: (entryId: string, index: number) => void;
  clearEntry: (entryId: string) => void;
}

export const useAttachmentStore = create<AttachmentStore>((set) => ({
  files: {},

  addFiles: (entryId, newFiles) =>
    set((state) => ({
      files: {
        ...state.files,
        [entryId]: [...(state.files[entryId] ?? []), ...newFiles],
      },
    })),

  removeFile: (entryId, index) =>
    set((state) => ({
      files: {
        ...state.files,
        [entryId]: (state.files[entryId] ?? []).filter((_, i) => i !== index),
      },
    })),

  clearEntry: (entryId) =>
    set((state) => {
      const { [entryId]: _removed, ...rest } = state.files;
      return { files: rest };
    }),
}));
