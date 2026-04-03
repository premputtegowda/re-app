'use client';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Access token lives in memory only — never written to localStorage.
// The refresh token is an HttpOnly cookie managed entirely by the browser.
let accessToken: string | null = null;
let accessTokenExpiresAt: number | null = null;

export const setAccessToken = (token: string, expiresInSeconds = 900) => {
  accessToken = token;
  accessTokenExpiresAt = Date.now() + expiresInSeconds * 1000;
};

export const clearAccessToken = () => {
  accessToken = null;
  accessTokenExpiresAt = null;
};

const isAccessTokenExpiringSoon = (): boolean => {
  if (!accessTokenExpiresAt) return false;
  return Date.now() > accessTokenExpiresAt - 60_000;
};

// API error class
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// Refresh access token using the HttpOnly cookie (no body needed).
// Returns true and updates the in-memory token on success.
export const refreshAccessToken = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // sends the HttpOnly refresh_token cookie
    });

    if (!response.ok) {
      if (response.status === 401) clearAccessToken();
      return false;
    }

    const data = await response.json();
    setAccessToken(data.access_token, data.expires_in ?? 900);
    return true;
  } catch {
    // Network error — keep current state, don't log user out
    return false;
  }
};

// Base fetch with auth — all requests include credentials so the browser
// automatically sends the HttpOnly cookie on auth endpoints.
const authFetch = async (
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> => {
  // Proactively refresh if the access token is missing or about to expire
  if (!accessToken || isAccessTokenExpiringSoon()) {
    await refreshAccessToken();
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  // On 401, attempt one silent refresh and retry
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
        credentials: 'include',
      });
    }
  }

  return response;
};

// API methods
export const api = {
  // Auth
  async googleLogin(credential: string) {
    const response = await fetch(`${API_BASE_URL}/api/auth/google/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
      credentials: 'include', // receives the HttpOnly refresh_token cookie
    });

    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Login failed');
    }

    const data = await response.json();
    setAccessToken(data.access_token, data.expires_in ?? 900);
    return data;
  },

  async logout() {
    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include', // sends cookie so backend can invalidate it
      });
    } catch {
      // Ignore logout errors — clear local state regardless
    }
    clearAccessToken();
  },

  async getCurrentUser() {
    const response = await authFetch('/api/auth/me');
    if (!response.ok) {
      if (response.status === 401) {
        clearAccessToken();
        return null;
      }
      throw new ApiError(response.status, 'Failed to get user');
    }
    return response.json();
  },

  // Categories
  async getCategories() {
    const response = await authFetch('/api/categories');
    if (!response.ok) throw new ApiError(response.status, 'Failed to get categories');
    return response.json();
  },

  async createCategory(data: { name: string; color: string }) {
    const response = await authFetch('/api/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to create category');
    }
    return response.json();
  },

  async updateCategory(id: string, data: { name?: string; color?: string }) {
    const response = await authFetch(`/api/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to update category');
    }
    return response.json();
  },

  async deleteCategory(id: string) {
    const response = await authFetch(`/api/categories/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to delete category');
    }
  },

  // Properties
  async getProperties() {
    const response = await authFetch('/api/properties');
    if (!response.ok) throw new ApiError(response.status, 'Failed to get properties');
    return response.json();
  },

  async createProperty(data: { name: string; address?: string }) {
    const response = await authFetch('/api/properties', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to create property');
    }
    return response.json();
  },

  async updateProperty(id: string, data: { name?: string; address?: string }) {
    const response = await authFetch(`/api/properties/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to update property');
    }
    return response.json();
  },

  async deleteProperty(id: string) {
    const response = await authFetch(`/api/properties/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to delete property');
    }
  },

  // Entries
  async getEntries(params?: {
    date_from?: string;
    date_to?: string;
    category_id?: string;
    property_id?: string;
    type?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.append(key, String(value));
      });
    }
    const query = searchParams.toString();
    const response = await authFetch(`/api/entries${query ? `?${query}` : ''}`);
    if (!response.ok) throw new ApiError(response.status, 'Failed to get entries');
    return response.json();
  },

  async createEntry(data: {
    date: string;
    hours: number;
    minutes: number;
    category_id: string;
    property_id: string;
    type: string;
    description: string;
    raw_description?: string;
    refined_description?: string;
    ai_category_id?: string;
    ai_type?: string;
    notes?: string;
  }) {
    const response = await authFetch('/api/entries', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      const message = Array.isArray(error.detail)
        ? error.detail.map((e: { msg: string }) => e.msg).join(', ')
        : error.detail || 'Failed to create entry';
      throw new ApiError(response.status, message);
    }
    return response.json();
  },

  async updateEntry(
    id: string,
    data: {
      date?: string;
      hours?: number;
      minutes?: number;
      category_id?: string;
      property_id?: string;
      type?: string;
      description?: string;
      raw_description?: string;
      refined_description?: string;
      ai_category_id?: string;
      ai_type?: string;
      notes?: string;
    }
  ) {
    const response = await authFetch(`/api/entries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      console.log('Update error response:', JSON.stringify(error, null, 2));
      const message = Array.isArray(error.detail)
        ? error.detail.map((e: { msg: string; loc?: string[] }) => `${e.loc?.join('.')}: ${e.msg}`).join(', ')
        : error.detail || 'Failed to update entry';
      throw new ApiError(response.status, message);
    }
    return response.json();
  },

  // Attachments
  async getDownloadUrl(file_ref: string): Promise<string> {
    const response = await authFetch('/api/entries/download-url', {
      method: 'POST',
      body: JSON.stringify({ file_ref }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to get download URL');
    }
    const data = await response.json();
    return data.url;
  },

  async presignUpload(data: { entry_id: string; filename: string; content_type: string }) {
    const response = await authFetch('/api/entries/presign', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to get upload URL');
    }
    return response.json() as Promise<{ upload_url: string; key: string }>;
  },

  async createAttachment(
    entryId: string,
    data: {
      file_ref: string;
      attachment_url: string;
      original_filename: string;
      content_type: string;
      file_size: number;
    }
  ) {
    const response = await authFetch(`/api/entries/${entryId}/attachments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to save attachment');
    }
    return response.json();
  },

  async deleteAttachment(entryId: string, attachmentId: string) {
    const response = await authFetch(`/api/entries/${entryId}/attachments/${attachmentId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to delete attachment');
    }
  },

  async deleteEntry(id: string) {
    const response = await authFetch(`/api/entries/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to delete entry');
    }
  },

  async classifyActivity(description: string) {
    const response = await authFetch('/api/entries/classify', {
      method: 'POST',
      body: JSON.stringify({ description }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Classification failed');
    }
    return response.json();
  },

  async bulkCreateEntries(
    entries: Array<{
      date: string;
      hours: number;
      minutes: number;
      category_id: string;
      property_id: string;
      type: string;
      description: string;
    }>
  ) {
    const response = await authFetch('/api/entries/bulk', {
      method: 'POST',
      body: JSON.stringify({ entries }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to bulk create entries');
    }
    return response.json();
  },

  // Analytics
  async getSummary() {
    const response = await authFetch('/api/analytics/summary');
    if (!response.ok) throw new ApiError(response.status, 'Failed to get summary');
    return response.json();
  },

  async getByCategory() {
    const response = await authFetch('/api/analytics/by-category');
    if (!response.ok) throw new ApiError(response.status, 'Failed to get category analytics');
    return response.json();
  },

  async getByProperty() {
    const response = await authFetch('/api/analytics/by-property');
    if (!response.ok) throw new ApiError(response.status, 'Failed to get property analytics');
    return response.json();
  },

  async getMonthly() {
    const response = await authFetch('/api/analytics/monthly');
    if (!response.ok) throw new ApiError(response.status, 'Failed to get monthly analytics');
    return response.json();
  },

  // ── Admin ──────────────────────────────────────────────────────────────

  async adminListUsers() {
    const response = await authFetch('/api/admin/users');
    if (!response.ok) throw new ApiError(response.status, 'Failed to fetch users');
    return response.json();
  },

  async adminPatchUser(userId: string, patch: { is_admin?: boolean; has_complimentary_access?: boolean; add_feature?: string; remove_feature?: string }) {
    const response = await authFetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to update user');
    }
    return response.json();
  },

  async adminDeleteUser(userId: string) {
    const response = await authFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to delete user');
    }
  },

  async adminListInvitations() {
    const response = await authFetch('/api/admin/invitations');
    if (!response.ok) throw new ApiError(response.status, 'Failed to fetch invitations');
    return response.json();
  },

  async adminCreateInvitation(email: string) {
    const response = await authFetch('/api/admin/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to create invitation');
    }
    return response.json();
  },

  async adminRevokeInvitation(invitationId: string) {
    const response = await authFetch(`/api/admin/invitations/${invitationId}`, { method: 'DELETE' });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to revoke invitation');
    }
  },

  async adminListAccessRequests() {
    const response = await authFetch('/api/admin/access-requests');
    if (!response.ok) throw new ApiError(response.status, 'Failed to fetch access requests');
    return response.json();
  },

  async adminApproveAccessRequest(requestId: string) {
    const response = await authFetch(`/api/admin/access-requests/${requestId}/approve`, { method: 'POST' });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to approve request');
    }
    return response.json();
  },

  async downloadAuditPackage(year: number): Promise<Blob> {
    const response = await authFetch(`/api/export/audit-package?year=${year}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(response.status, error.detail || 'Failed to generate audit package');
    }
    return response.blob();
  },

  async adminDeclineAccessRequest(requestId: string) {
    const response = await authFetch(`/api/admin/access-requests/${requestId}/decline`, { method: 'POST' });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to decline request');
    }
  },

  // ── Deal Analyzer ──────────────────────────────────────────────────────

  async listDeals() {
    const response = await authFetch('/api/deals');
    if (!response.ok) throw new ApiError(response.status, 'Failed to fetch deals');
    return response.json();
  },

  async saveDeal(deal: {
    id: string;
    name: string;
    acquisition: unknown;
    operations: unknown;
    proForma: unknown;
    refinance: unknown;
    results: unknown;
    mcRanges?: unknown;
    mcResults?: unknown;
    currentStep?: number;
    calcState?: unknown;
    savedAt: string;
    updatedAt: string;
  }) {
    const response = await authFetch('/api/deals', {
      method: 'POST',
      body: JSON.stringify(deal),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(response.status, error.detail || 'Failed to save deal');
    }
    return response.json();
  },

  async updateDeal(dealId: string, payload: {
    name: string;
    acquisition: unknown;
    operations: unknown;
    proForma: unknown;
    refinance: unknown;
    results: unknown;
    mcRanges?: unknown;
    mcResults?: unknown;
    currentStep?: number;
    calcState?: unknown;
    updatedAt: string;
  }) {
    const response = await authFetch(`/api/deals/${dealId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(response.status, error.detail || 'Failed to update deal');
    }
    return response.json();
  },

  async deleteDeal(dealId: string) {
    const response = await authFetch(`/api/deals/${dealId}`, { method: 'DELETE' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(response.status, error.detail || 'Failed to delete deal');
    }
  },
};
