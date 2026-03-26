'use client';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Token management
let accessToken: string | null = null;
let refreshToken: string | null = null;

// Access token expiry stored as Unix ms timestamp
let accessTokenExpiresAt: number | null = null;

export const setTokens = (access: string, refresh: string, expiresInSeconds = 900) => {
  accessToken = access;
  refreshToken = refresh;
  accessTokenExpiresAt = Date.now() + expiresInSeconds * 1000;
  if (typeof window !== 'undefined') {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    localStorage.setItem('access_token_expires_at', String(accessTokenExpiresAt));
  }
};

export const getTokens = () => {
  if (typeof window !== 'undefined' && !accessToken) {
    accessToken = localStorage.getItem('access_token');
    refreshToken = localStorage.getItem('refresh_token');
    const exp = localStorage.getItem('access_token_expires_at');
    accessTokenExpiresAt = exp ? Number(exp) : null;
  }
  return { accessToken, refreshToken, accessTokenExpiresAt };
};

export const clearTokens = () => {
  accessToken = null;
  refreshToken = null;
  accessTokenExpiresAt = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('access_token_expires_at');
  }
};

const isAccessTokenExpiringSoon = (): boolean => {
  const { accessTokenExpiresAt: exp } = getTokens();
  if (!exp) return false;
  // Refresh if less than 60 seconds remaining
  return Date.now() > exp - 60_000;
};

// API error class
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// Refresh access token
export const refreshAccessToken = async (): Promise<boolean> => {
  const { refreshToken: currentRefresh } = getTokens();
  if (!currentRefresh) return false;

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: currentRefresh }),
    });

    if (!response.ok) {
      // Only clear tokens on explicit auth rejection, not server errors
      if (response.status === 401) clearTokens();
      return false;
    }

    const data = await response.json();
    setTokens(data.access_token, data.refresh_token, data.expires_in ?? 900);
    return true;
  } catch {
    // Network error — keep tokens, don't log the user out
    return false;
  }
};

// Base fetch with auth
const authFetch = async (
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> => {
  // Proactively refresh if the access token is about to expire or missing
  if (!getTokens().accessToken || isAccessTokenExpiringSoon()) {
    await refreshAccessToken();
  }

  let { accessToken: token } = getTokens();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  let response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  // If unauthorized, try to refresh token and retry once
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      ({ accessToken: token } = getTokens());
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
      response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
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
    });

    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Login failed');
    }

    const data = await response.json();
    setTokens(data.access_token, data.refresh_token, data.expires_in ?? 900);
    return data;
  },

  async logout() {
    const { refreshToken: token } = getTokens();
    if (token) {
      try {
        await authFetch('/api/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refresh_token: token }),
        });
      } catch {
        // Ignore logout errors
      }
    }
    clearTokens();
  },

  async getCurrentUser() {
    const response = await authFetch('/api/auth/me');
    if (!response.ok) {
      if (response.status === 401) {
        clearTokens();
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
};
