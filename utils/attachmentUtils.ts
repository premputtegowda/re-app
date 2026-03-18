/**
 * For Dropbox links: convert a view link (?dl=0) to a direct download link (?dl=1).
 * Returns null for non-Dropbox URLs.
 */
export function dropboxDownloadUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('dropbox.com')) return null;
    u.searchParams.set('dl', '1');
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Try to extract a human-readable label from an attachment URL.
 * Returns the filename if it can be parsed from the path, otherwise
 * returns a service name derived from the hostname.
 */
export function labelFromUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);

    // Try the last path segment — works for Dropbox and direct file links
    const segments = u.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) {
      const decoded = decodeURIComponent(last);
      // Accept it as a filename if it has an extension or looks descriptive (not just an ID)
      if (decoded.includes('.') || decoded.length < 40) {
        return decoded;
      }
    }

    // Fallback: use the hostname stripped of www/subdomain noise
    const host = u.hostname.replace(/^www\./, '');
    if (host.includes('dropbox.com'))   return 'Dropbox file';
    if (host.includes('icloud.com'))    return 'iCloud file';
    if (host.includes('drive.google'))  return 'Google Drive file';
    if (host.includes('1drv.ms') || host.includes('onedrive')) return 'OneDrive file';
    if (host.includes('box.com'))       return 'Box file';
    return host;
  } catch {
    return '';
  }
}
