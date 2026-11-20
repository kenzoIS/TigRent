import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import { Icon } from '@/components/design-system/Icon';
import { Text } from '@/components/design-system/Text';
import { Tiggy } from '@/components/mascot/Tiggy';
import { appConfig } from '@/config/app';
import { useMotion } from '@/lib/motion';
import { colors, elevation, radii, spacing } from '@/theme';

type Props = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** State-driven tip (features/mascot/dialogue). Null when there is nothing truthful to say. */
  tip: string | null;
  /** Small control on the eyebrow line, e.g. the notification bell. */
  right?: ReactNode;
};

/**
 * Dashboard greeting with Tiggy beside it (owner feedback 2026-11-18): compact header, larger waving
 * mascot, and the tip opening in place below, so nothing is reserved while it's closed.
 */
export function GreetingHeader({ eyebrow, title, subtitle, tip, right }: Props) {
  const focused = useIsFocused();
  const { reduceMotion } = useMotion();
  const [open, setOpen] = useState(false);
  const showTip = open && Boolean(tip);
  const name = appConfig.mascot.name;

  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        <Text variant="overline" tone="link" uppercase style={styles.flex}>{eyebrow}</Text>
        {right}
      </View>
      <View style={styles.mainRow}>
        <View style={styles.text}>
          <Text variant="largeTitle" numberOfLines={2}>{title}</Text>
          {subtitle ? <Text variant="callout" tone="muted">{subtitle}</Text> : null}
          {/* The toggle stays mounted while a tip exists so the text column keeps its height and the
              greeting never shifts when the tip opens (owner feedback 2026-11-19). */}
          {tip ? (
            <Pressable
              onPress={() => setOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityLabel={showTip ? `Hide ${name}’s tip` : `Show ${name}’s tip`}
              accessibilityState={{ expanded: showTip }}
              hitSlop={8}
              style={styles.hint}
              testID="tiggy-hint"
            >
              <View style={[styles.hintDot, showTip ? styles.hintDotOpen : null]} />
              <Text variant="subhead" tone="link" numberOfLines={1} style={styles.hintText}>{showTip ? `Hide ${name}’s tip` : `${name} has a tip for you`}</Text>
            </Pressable>
          ) : null}
        </View>
        <Tiggy size="header" message={tip ?? undefined} wave={focused} external={{ open: showTip, onToggle: () => setOpen((o) => !o) }} testID="tiggy" />
      </View>
      {showTip ? (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(160)}
          exiting={reduceMotion ? undefined : FadeOut.duration(120)}
          style={[styles.bubble, elevation.low]}
          accessibilityLiveRegion="polite"
          testID="tiggy-bubble"
        >
          <View style={styles.tail} />
          <Text variant="callout" style={styles.flex}>{tip}</Text>
          <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel={`Dismiss ${name}'s tip`} hitSlop={10} style={styles.close}>
            <Icon as={X} size="sm" color={colors.textMuted} />
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs, paddingTop: spacing.xs },
  topRow: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  mainRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  text: { flex: 1, gap: spacing.xs, paddingBottom: spacing.md },
  flex: { flex: 1 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, alignSelf: 'flex-start', minHeight: 32 },
  hintDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accentSecondary },
  hintDotOpen: { backgroundColor: colors.borderStrong },
  hintText: { fontWeight: '600' },
  bubble: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  tail: { position: 'absolute', top: -6, right: 56, width: 14, height: 14, backgroundColor: colors.surface, transform: [{ rotate: '45deg' }] },
  close: { padding: 2 },
});
