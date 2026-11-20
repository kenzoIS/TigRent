import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { colors, elevation, gutter, motion, radii, spacing, touchTarget } from '@/theme';
import { useMotion } from '@/lib/motion';
import { Icon } from './Icon';
import { Text } from './Text';

type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Sticky footer (e.g. confirm button) kept above the keyboard and home indicator. */
  footer?: ReactNode;
  scrollable?: boolean;
  testID?: string;
};

/** Focused bottom sheet. Backdrop tap, close button and Android back all dismiss. */
export function Sheet({ visible, onClose, title, description, children, footer, scrollable = true, testID }: SheetProps) {
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  // Mount immediately when opened (render-time state adjustment); unmount after the exit animation.
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    const duration = reduceMotion ? 0 : motion.sheet;
    if (visible) {
      progress.value = withTiming(1, { duration, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      progress.value = withTiming(0, { duration: reduceMotion ? 0 : motion.base }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
  }, [visible, reduceMotion, mounted, progress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * 420 }] }));

  if (!mounted) return null;
  const Body = scrollable ? ScrollView : View;

  return (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={onClose} testID={testID}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close sheet" />
        </Animated.View>
        <Animated.View
          style={[styles.panel, elevation.high, { paddingBottom: Math.max(insets.bottom, spacing.lg) }, panelStyle]}
          accessibilityViewIsModal
        >
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text variant="title2">{title}</Text>
              {description ? <Text variant="subhead" tone="muted">{description}</Text> : null}
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close} hitSlop={4}>
              <Icon as={X} color={colors.textMuted} />
            </Pressable>
          </View>
          <Body
            style={styles.body}
            contentContainerStyle={scrollable ? styles.bodyContent : undefined}
            keyboardShouldPersistTaps={scrollable ? 'handled' : undefined}
          >
            {children}
          </Body>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: colors.overlay },
  panel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '88%',
  },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.border, marginTop: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: gutter, paddingTop: spacing.md, gap: spacing.sm },
  headerText: { flex: 1, gap: spacing.xxs, paddingTop: spacing.xs },
  close: {
    width: touchTarget - 8,
    height: touchTarget - 8,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSunken,
  },
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: gutter, paddingTop: spacing.lg, paddingBottom: spacing.md },
  footer: { paddingHorizontal: gutter, paddingTop: spacing.sm },
});
