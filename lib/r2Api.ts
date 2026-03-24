'use client';

import { api } from './api';

export interface R2UploadResult {
  key: string;
  originalFilename: string;
  contentType: string;
  fileSize: number;
}

/**
 * Upload a file to R2 via a backend-generated pre-signed URL.
 * Returns the R2 object key and file metadata.
 */
export async function uploadFileToR2(
  file: File,
  entryId: string
): Promise<R2UploadResult> {
  // 1. Get pre-signed upload URL from backend
  const { upload_url, key } = await api.presignUpload({
    entry_id: entryId,
    filename: file.name,
    content_type: file.type || 'application/octet-stream',
  });

  // 2. Upload directly to R2
  const uploadRes = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });

  if (!uploadRes.ok) {
    throw new Error(`R2 upload failed: ${uploadRes.statusText}`);
  }

  return {
    key,
    originalFilename: file.name,
    contentType: file.type || 'application/octet-stream',
    fileSize: file.size,
  };
}
