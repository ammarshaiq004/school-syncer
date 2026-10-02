import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** Loads a GET endpoint (skipped when path is null), with pull-to-refresh support. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    if (!path) return;
    setRefreshing(true);
    try {
      setData(await api<T>(path));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [path]);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api<T>(path).then(
      (result) => !cancelled && (setData(result), setError('')),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { data, error, reload, refreshing };
}
