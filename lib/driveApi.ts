'use client';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const REPS_FOLDER_NAME = 'REPS Tracker';
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

// Module-level caches — valid for the session lifetime
let cachedToken: string | null = null;
let cachedFolderId: string | null = null;

/** Ensure the GIS script is loaded and window.google.accounts.oauth2 is ready */
function ensureGisLoaded(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const waitForOauth2 = () => {
      const poll = setInterval(() => {
        if ((window as any).google?.accounts?.oauth2) {
          clearInterval(poll);
          resolve();
        }
      }, 50);
      setTimeout(() => { clearInterval(poll); reject(new Error('GIS timeout')); }, 8000);
    };

    if (document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`)) {
      waitForOauth2();
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    // Poll after onload — GIS needs a moment to initialize oauth2
    script.onload = waitForOauth2;
    script.onerror = () => reject(new Error('GIS load failed'));
    document.head.appendChild(script);
  });
}

export interface DriveUploadResult {
  fileId: string;
  viewUrl: string;
}

/**
 * Request a Drive access token via GIS token client.
 * Shows a Google consent popup the first time; silent on subsequent calls
 * within the same session if the token is cached.
 * Returns null if the user declines or GIS is unavailable.
 */
export async function requestDriveToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;

  try {
    await ensureGisLoaded();
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    const g = (window as any).google?.accounts?.oauth2;
    if (!g) { resolve(null); return; }

    const client = g.initTokenClient({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      scope: DRIVE_SCOPE,
      callback: (response: any) => {
        if (response.error || !response.access_token) {
          resolve(null);
        } else {
          cachedToken = response.access_token;
          resolve(response.access_token);
        }
      },
      error_callback: () => resolve(null),
    });

    // prompt: '' = skip consent screen if already granted
    client.requestAccessToken({ prompt: '' });
  });
}

/** Clear cached token and folder ID (e.g. on logout or Drive disconnect). */
export function clearDriveToken() {
  cachedToken = null;
  cachedFolderId = null;
}

/** Find or create the "REPS Tracker" folder in the user's Drive. */
async function getOrCreateFolder(accessToken: string): Promise<string> {
  if (cachedFolderId) return cachedFolderId;

  const search = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `name='${REPS_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await search.json();
  if (searchData.files?.length > 0) {
    cachedFolderId = searchData.files[0].id;
    return cachedFolderId!;
  }

  const create = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: REPS_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const folder = await create.json();
  cachedFolderId = folder.id;
  return cachedFolderId!;
}

/**
 * Upload a file to the user's "REPS Tracker" Drive folder.
 * Returns { fileId, viewUrl } on success.
 */
export async function uploadFileToDrive(
  file: File,
  accessToken: string
): Promise<DriveUploadResult> {
  const folderId = await getOrCreateFolder(accessToken);

  const metadata = { name: file.name, parents: [folderId] };
  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', file);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? 'Drive upload failed');
  }

  const data = await res.json();
  return { fileId: data.id, viewUrl: data.webViewLink };
}
