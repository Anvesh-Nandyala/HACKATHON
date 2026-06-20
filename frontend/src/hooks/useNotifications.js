import { useEffect, useState } from 'react';
import { API_BASE } from '../api';

export function useNotifications(user) {
  const [lastNotification, setLastNotification] = useState(null);

  useEffect(() => {
    if (!user) {
      setLastNotification(null);
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const eventSource = new EventSource(`${API_BASE}/notifications/stream?token=${token}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') {
          console.log('[SSE] Connected to notification stream');
        } else {
          console.log('[SSE] Notification received:', data);
          setLastNotification(data);
        }
      } catch (err) {
        console.error('[SSE] Failed to parse message', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('[SSE] EventSource error', err);
    };

    return () => {
      eventSource.close();
    };
  }, [user]);

  return lastNotification;
}
