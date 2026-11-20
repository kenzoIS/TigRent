import { useEffect, useRef, useState } from 'react';
import { holdSecondsLeft } from '@/domain/bookings';

/**
 * Seconds left on a payment hold, ticking every second, measured against the server clock captured
 * with the booking (plan §10.1). Calls `onExpire` once when it reaches zero so the screen can re-read
 * the booking; the server decides the real expiry.
 */
export function useHoldCountdown(
  hold: { holdExpiresAt: string | null; serverNow: string; fetchedAtMs: number } | null,
  active: boolean,
  onExpire?: () => void,
): number {
  const compute = () => (hold ? holdSecondsLeft(hold.holdExpiresAt, hold.serverNow, hold.fetchedAtMs, Date.now()) : 0);
  const [seconds, setSeconds] = useState(compute);
  const [source, setSource] = useState(hold);
  if (source !== hold) {
    // New booking data: recompute during render instead of in an effect.
    setSource(hold);
    setSeconds(compute());
  }
  const expired = useRef(false);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!active || !hold?.holdExpiresAt) return;
    expired.current = false;
    const t = setInterval(() => {
      const left = holdSecondsLeft(hold.holdExpiresAt, hold.serverNow, hold.fetchedAtMs, Date.now());
      setSeconds(left);
      if (left <= 0 && !expired.current) {
        expired.current = true;
        onExpireRef.current?.();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [active, hold]);

  return seconds;
}
