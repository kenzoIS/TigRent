import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useReducedMotion } from 'react-native-reanimated';
import { appConfig } from '@/config/app';

const STORAGE_KEY = 'tigrent.reduceMotion';

type MotionPrefs = {
  /** True when nonessential motion must be skipped (OS setting or in-app override). */
  reduceMotion: boolean;
  /** True when the ambient background may animate. */
  ambientMotion: boolean;
  /** In-app override (Settings → Reduce motion), also useful on low-end devices. Persisted per device. */
  setReduceMotionOverride: (value: boolean | null) => void;
  reduceMotionOverride: boolean | null;
};

const MotionContext = createContext<MotionPrefs | null>(null);

export function MotionProvider({ children, forceReduced }: { children: ReactNode; forceReduced?: boolean }) {
  const systemReduced = useReducedMotion();
  const [override, setOverride] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => active && v !== null && setOverride(v === 'true'))
      .catch(() => undefined); // preference is optional; the OS setting still applies
    return () => {
      active = false;
    };
  }, []);

  const setReduceMotionOverride = useCallback((value: boolean | null) => {
    setOverride(value);
    const write = value === null ? AsyncStorage.removeItem(STORAGE_KEY) : AsyncStorage.setItem(STORAGE_KEY, String(value));
    write.catch(() => undefined);
  }, []);

  const value = useMemo<MotionPrefs>(() => {
    const reduceMotion = forceReduced ?? override ?? systemReduced;
    return {
      reduceMotion,
      ambientMotion: appConfig.motion.ambientEnabled && !reduceMotion,
      reduceMotionOverride: override,
      setReduceMotionOverride,
    };
  }, [forceReduced, override, systemReduced, setReduceMotionOverride]);
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotion(): MotionPrefs {
  const ctx = useContext(MotionContext);
  if (!ctx) throw new Error('useMotion must be used inside <MotionProvider>');
  return ctx;
}
