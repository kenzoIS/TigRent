import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, elevation, gutter, radii, spacing } from '@/theme';
import { useMotion } from '@/lib/motion';
import { toneColors, type Tone } from './Banner';
import { Icon } from './Icon';
import { Text } from './Text';

type ToastInput = { title: string; message?: string; tone?: Tone; durationMs?: number };
type ToastItem = ToastInput & { id: number };
type ToastApi = { show: (t: ToastInput) => void; dismiss: () => void };

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useMotion();

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback((t: ToastInput) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ ...t, id: Date.now() });
    AccessibilityInfo.announceForAccessibility([t.title, t.message].filter(Boolean).join('. '));
    timer.current = setTimeout(() => setToast(null), t.durationMs ?? 3500);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  const tone = toneColors[toast?.tone ?? 'neutral'];

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <View pointerEvents="box-none" style={[styles.host, { top: insets.top + spacing.sm }]}>
          <Animated.View
            key={toast.id}
            entering={reduceMotion ? undefined : FadeInUp.duration(200)}
            exiting={reduceMotion ? undefined : FadeOutUp.duration(160)}
          >
            <Pressable onPress={dismiss} accessibilityRole="button" accessibilityHint="Dismisses this message" style={[styles.toast, elevation.mid]}>
              <View style={[styles.dot, { backgroundColor: tone.bg }]}>
                <Icon as={tone.icon} size="sm" color={tone.fg} />
              </View>
              <View style={styles.text}>
                <Text variant="bodyStrong" tone="onInk">{toast.title}</Text>
                {toast.message ? <Text variant="footnote" style={styles.message}>{toast.message}</Text> : null}
              </View>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: gutter, right: gutter },
  toast: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.ink, borderRadius: radii.lg, padding: spacing.md },
  dot: { width: 32, height: 32, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  message: { color: '#D9D2C2' },
});
