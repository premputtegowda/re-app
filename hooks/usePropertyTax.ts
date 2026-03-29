import { useState, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import type { PropertyTaxResult } from '@/types';

interface PropertyTaxState {
  status: 'idle' | 'loading' | 'success' | 'error';
  result: PropertyTaxResult | null;
  error: string | null;
}

/**
 * Hook for estimating property tax via the /api/property-tax/estimate endpoint.
 * Uses the shared api client which handles token refresh and auth headers.
 */
export function usePropertyTax() {
  const [state, setState] = useState<PropertyTaxState>({
    status: 'idle',
    result: null,
    error: null,
  });

  const estimate = useCallback(async (address: string, purchasePrice: number): Promise<void> => {
    setState({ status: 'loading', result: null, error: null });
    try {
      const data: PropertyTaxResult = await api.estimatePropertyTax(address, purchasePrice);
      setState({ status: 'success', result: data, error: null });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Unable to retrieve tax info — please enter your own estimate';
      setState({ status: 'error', result: null, error: message });
    }
  }, []);

  return { ...state, estimate };
}
