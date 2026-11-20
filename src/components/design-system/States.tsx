import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, cancelAnimation } from 'react-native-reanimated';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import { colors, radii, spacing } from '@/theme';
import { useMotion } from '@/lib/motion';
import { Button } from './Button';
import { Icon, type IconComponent } from './Icon';
import { Text } from './Text';

type Action = { label: string; onPress: () => void };

type EmptyStateProps = {
  title: string;
  message: string;
  icon?: IconComponent;
  /** Illustration slot, e.g. <Tiggy size="sm" />. Overrides icon. */
  illustration?: ReactNode;
  action?: Action;
  secondaryAction?: Action;
  testID?: string;
};

/** Empty state with a working next action (plan Phase 5: no dead-end illustrations). */
export function EmptyState({ title, message, icon, illustration, action, secondaryAction, testID }: EmptyStateProps) {
  return (
    <View style={styles.root} testID={testID}>
      {illustration ?? (icon ? (
        <View style={styles.iconCircle}>
          <Icon as={icon} size="xl" color={colors.link} />
        </View>
      ) : null)}
      <View style={styles.text}>
        <Text variant="title2" align="center">{title}</Text>
        <Text variant="callout" tone="muted" align="center">{message}</Text>
      </View>
      {action || secondaryAction ? (
        <View style={styles.actions}>
          {action ? <Button label={action.label} onPress={action.onPress} /> : null}
          {secondaryAction ? <Button label={secondaryAction.label} variant="ghost" onPress={secondaryAction.onPress} /> : null}
        </View>
      ) : null}
    </View>
  );
}

type ErrorStateProps = { title?: string; message: string; onRetry?: () => void; retrying?: boolean; offline?: boolean };

export function ErrorState({ title = 'Something went wrong', message, onRetry, retrying, offline }: ErrorStateProps) {
  return (
    <View style={styles.root} accessibilityRole="alert">
      <View style={[styles.iconCircle, { backgroundColor: colors.dangerSoft }]}>
        <Icon as={offline ? CloudOff : RefreshCw} size="xl" color={colors.danger} />
      </View>
      <View style={styles.text}>
        <Text variant="title2" align="center">{offline ? 'You’re offline' : title}</Text>
        <Text variant="callout" tone="muted" align="center">{message}</Text>
      </View>
      {onRetry ? <Button label="Try again" variant="secondary" icon={RefreshCw} loading={retrying} onPress={onRetry} /> : null}
    </View>
  );
}

/** Loading placeholder block; pulses unless reduced motion is on. */
export function Skeleton({ width = '100%', height = 16, radius = radii.xs }: { width?: DimensionValue; height?: number; radius?: number }) {
  const { reduceMotion } = useMotion();
  const opacity = useSharedValue(0.55);
  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 0.55;
      return;
    }
    opacity.value = withRepeat(withTiming(1, { duration: 750 }), -1, true);
    return () => cancelAnimation(opacity);
  }, [reduceMotion, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceSunken }, style]} />;
}

export function LoadingRows({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }} style={styles.rows}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.loadingRow}>
          <Skeleton width={52} height={52} radius={radii.sm} />
          <View style={styles.loadingText}>
            <Skeleton width="70%" />
            <Skeleton width="40%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.lg },
  iconCircle: { width: 72, height: 72, borderRadius: radii.pill, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  text: { gap: spacing.sm, maxWidth: 340 },
  actions: { alignSelf: 'stretch', gap: spacing.xs, maxWidth: 340, width: '100%' },
  rows: { gap: spacing.lg },
  loadingRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  loadingText: { flex: 1, gap: spacing.sm },
});
