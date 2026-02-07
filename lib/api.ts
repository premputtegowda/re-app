'use client';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Token management
let accessToken: string | null = null;
let refreshToken: string | null = null;

export const setTokens = (access: string, refresh: string) => {
  accessToken = access;
  refreshToken = refresh;
  if (typeof window !== 'undefined') {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
  }
};

export const getTokens = () => {
  if (typeof window !== 'undefined' && !accessToken) {
    accessToken = localStorage.getItem('access_token');
    refreshToken = localStorage.getItem('refresh_token');
  }
  return { accessToken, refreshToken };
};

export const clearTokens = () => {
  accessToken = null;
  refreshToken = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  }
};

// API error class
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// Refresh access token
const refreshAccessToken = async (): Promise<boolean> => {
  const { refreshToken: currentRefresh } = getTokens();
  if (!currentRefresh) return false;

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: currentRefresh }),
    });

    if (!response.ok) {
      clearTokens();
      return false;
    }

    const data = await response.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    clearTokens();
    return false;
  }
};

// Base fetch with auth
const authFetch = async (
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> => {
  const { accessToken: token } = getTokens();

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

  // If unauthorized, try to refresh token
  if (response.status === 401 && token) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const { accessToken: newToken } = getTokens();
      (headers as Record<string, string>)['Authorization'] = `Bearer ${newToken}`;
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
    setTokens(data.access_token, data.refresh_token);
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
    entry_type: string;
    description: string;
  }) {
    const response = await authFetch('/api/entries', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to create entry');
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
      entry_type?: string;
      description?: string;
    }
  ) {
    const response = await authFetch(`/api/entries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(response.status, error.detail || 'Failed to update entry');
    }
    return response.json();
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

  async bulkCreateEntries(
    entries: Array<{
      date: string;
      hours: number;
      minutes: number;
      category_id: string;
      property_id: string;
      entry_type: string;
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
};
