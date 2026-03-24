'use client';

import { create } from 'zustand';

export type AttachmentStatus = 'idle' | 'uploading' | 'uploaded' | 'error';

export interface PendingAttachment {
  file: File | null;       // null for link-only entries
  label: string;           // display name — filename for file picks, user-typed for link-only
  status: AttachmentStatus;
  r2Key: string;           // R2 object key after upload
  fileUrl: string;         // pre-signed download URL (refreshed on load)
  manualUrl: string;       // for manually pasted links
  errorMsg: string;
}

interface AttachmentStore {
  attachments: Record<string, PendingAttachment[]>;

  addFiles: (key: string, files: File[]) => void;
  addLink: (key: string) => void;
  updateAttachment: (key: string, index: number, patch: Partial<PendingAttachment>) => void;
  removeAttachment: (key: string, index: number) => void;
  clearKey: (key: string) => void;
}

export const useAttachmentStore = create<AttachmentStore>((set) => ({
  attachments: {},

  addFiles: (key, files) =>
    set((state) => ({
      attachments: {
        ...state.attachments,
        [key]: [
          ...(state.attachments[key] ?? []),
          ...files.map((file) => ({
            file,
            label: file.name,
            status: 'idle' as AttachmentStatus,
            r2Key: '',
            fileUrl: '',
            manualUrl: '',
            errorMsg: '',
          })),
        ],
      },
    })),

  addLink: (key) =>
    set((state) => ({
      attachments: {
        ...state.attachments,
        [key]: [
          ...(state.attachments[key] ?? []),
          {
            file: null,
            label: '',
            status: 'idle' as AttachmentStatus,
            r2Key: '',
            fileUrl: '',
            manualUrl: '',
            errorMsg: '',
          },
        ],
      },
    })),

  updateAttachment: (key, index, patch) =>
    set((state) => {
      const list = [...(state.attachments[key] ?? [])];
      list[index] = { ...list[index], ...patch };
      return { attachments: { ...state.attachments, [key]: list } };
    }),

  removeAttachment: (key, index) =>
    set((state) => ({
      attachments: {
        ...state.attachments,
        [key]: (state.attachments[key] ?? []).filter((_, i) => i !== index),
      },
    })),

  clearKey: (key) =>
    set((state) => {
      const { [key]: _removed, ...rest } = state.attachments;
      return { attachments: rest };
    }),
}));
