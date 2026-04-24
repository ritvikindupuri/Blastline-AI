import { useState, useEffect } from 'react';

// Time synchronization module
let timeOffset = 0;
let isSynced = false;
let syncPromise: Promise<void> | null = null;

export async function syncTime() {
  if (isSynced) return;
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    try {
      // Use WorldTimeAPI for standard time
      const response = await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC');
      if (!response.ok) throw new Error('Failed to fetch time');
      const data = await response.json();

      const serverTime = new Date(data.utc_datetime).getTime();
      const localTime = Date.now();

      // Calculate the offset between server time and local time
      timeOffset = serverTime - localTime;
      isSynced = true;
    } catch (error) {
      console.error('Time synchronization failed, falling back to local time:', error);
      // Fallback to 0 offset if sync fails
      timeOffset = 0;
      isSynced = true; // Still mark as synced so we don't infinitely retry on failure
    }
  })();

  return syncPromise;
}

export function getSyncedTime(): Date {
  return new Date(Date.now() + timeOffset);
}

// React hook for getting synchronized time and automatically updating
export function useSyncedTime(updateInterval = 1000) {
  const [time, setTime] = useState<Date>(getSyncedTime());

  useEffect(() => {
    // Initial sync
    syncTime();

    // Update the time state at the specified interval
    const intervalId = setInterval(() => {
      setTime(getSyncedTime());
    }, updateInterval);

    return () => clearInterval(intervalId);
  }, [updateInterval]);

  return time;
}

// Function to format synchronized dates properly
export function formatSyncedDate(date: Date | string | number): string {
  const d = new Date(date);
  return d.toLocaleString();
}
