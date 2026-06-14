import { useState, useEffect, useCallback } from 'react';
import { cacheResponse, getCached } from '../services/cacheManager';

/**
 * Custom hook implementing stale-while-revalidate pattern.
 * Returns cached data immediately, fetches fresh in background.
 * Falls back to cached data if fetch fails or exceeds timeout.
 */

const DEFAULT_TIMEOUT = 3000; // 3 seconds
const DEFAULT_CACHE_AGE = 60000; // 1 minute

export function useGracefulFetch(url, options = {}) {
  const {
    cacheKey,
    timeout = DEFAULT_TIMEOUT,
    cacheAge = DEFAULT_CACHE_AGE,
    headers = {},
    enabled = true,
  } = options;

  const key = cacheKey || url;
  const [data, setData] = useState(null);
  const [isStale, setIsStale] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Monitor online status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const fetchData = useCallback(async () => {
    if (!enabled || !url) return;

    // Return cached data immediately
    const cached = getCached(key);
    if (cached) {
      setData(cached.data);
      setIsStale(cached.isStale);
      setLastUpdated(new Date(cached.cachedAt));
    }

    // If offline, don't attempt fetch
    if (!navigator.onLine) {
      setIsOffline(true);
      return;
    }

    setIsFetching(true);
    setError(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const token = localStorage.getItem('token');
      const fetchHeaders = { ...headers };
      if (token) fetchHeaders.Authorization = `Bearer ${token}`;

      const response = await fetch(url, {
        headers: fetchHeaders,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const freshData = await response.json();
      setData(freshData);
      setIsStale(false);
      setLastUpdated(new Date());
      setError(null);

      // Cache the fresh response
      cacheResponse(key, freshData, cacheAge);
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Request timed out');
      } else {
        setError(err.message);
      }
      // Keep showing cached data if available
      if (!data && cached) {
        setData(cached.data);
        setIsStale(true);
      }
    } finally {
      setIsFetching(false);
    }
  }, [url, key, enabled, timeout, cacheAge]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh when coming back online
  useEffect(() => {
    if (!isOffline && isStale) {
      fetchData();
    }
  }, [isOffline]);

  return { data, isStale, isOffline, isFetching, error, lastUpdated, refetch: fetchData };
}
