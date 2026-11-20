import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useCanGoBack } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { colors, radii, spacing, touchTarget } from '@/theme';
import { Icon } from './Icon';
import { Text } from './Text';

type Props = {
  title: string;
  subtitle?: string;
  /** Small label above the title (e.g. "Lender"). */
  eyebrow?: string;
  /** Show a back button. Defaults to true when navigation can go back. */
  back?: boolean | (() => void);
  right?: ReactNode;
  size?: 'large' | 'compact';
};

export function ScreenHeader({ title, subtitle, eyebrow, back, right, size = 'large' }: Props) {
  const canGoBack = useCanGoBack();
  const showBack = back === undefined ? canGoBack && size === 'compact' : Boolean(back);
  // Deep links may open a screen with no history: fall back to the app start instead of a dead back button.
  const onBack = typeof back === 'function' ? back : () => (canGoBack ? router.back() : router.replace('/'));

  return (
    <View style={styles.root}>
      {showBack || (right && size === 'compact') ? (
        <View style={styles.bar}>
          {showBack ? (
            <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={styles.back} hitSlop={6}>
              <Icon as={ChevronLeft} size="lg" color={colors.text} />
            </Pressable>
          ) : (
            <View />
          )}
          {size === 'compact' ? (
            <Text variant="headline" numberOfLines={1} style={styles.compactTitle} accessibilityRole="header">{title}</Text>
          ) : null}
          <View style={styles.right}>{right}</View>
        </View>
      ) : null}
      {size === 'large' ? (
        <View style={styles.largeRow}>
          <View style={[styles.titles, styles.flex]}>
            {eyebrow ? <Text variant="overline" tone="link" uppercase>{eyebrow}</Text> : null}
            <Text variant="largeTitle">{title}</Text>
            {subtitle ? <Text variant="callout" tone="muted">{subtitle}</Text> : null}
          </View>
          {/* With a back button the right control already sits in the bar above. */}
          {right && !showBack ? <View style={styles.largeRight}>{right}</View> : null}
        </View>
      ) : subtitle ? (
        <Text variant="subhead" tone="muted" align="center">{subtitle}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.md },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: touchTarget },
  back: { width: touchTarget, height: touchTarget, marginLeft: -spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  compactTitle: { flex: 1, textAlign: 'center' },
  right: { minWidth: touchTarget - spacing.md, flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xs },
  titles: { gap: spacing.xs },
  largeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  largeRight: { paddingTop: spacing.xs },
  flex: { flex: 1 },
});
