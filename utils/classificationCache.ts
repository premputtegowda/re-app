import type { ClassificationResult } from '@/types';

const CACHE_KEY = 'reps_classification_cache';
const MAX_ENTRIES = 200;

export function getCachedClassification(description: string): ClassificationResult | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as Record<string, ClassificationResult>;
    return cache[description] ?? null;
  } catch {
    return null;
  }
}

export function setCachedClassification(description: string, result: ClassificationResult): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const cache = raw ? (JSON.parse(raw) as Record<string, ClassificationResult>) : {};
    cache[description] = result;
    const keys = Object.keys(cache);
    if (keys.length > MAX_ENTRIES) {
      keys.slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete cache[k]);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore storage errors
  }
}
