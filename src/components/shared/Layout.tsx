import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Icon } from '@/components/design-system/Icon';
import { Text } from '@/components/design-system/Text';
import { colors, maxFontScale, radii, spacing } from '@/theme';

/** Typographic section label with optional action, instead of wrapping everything in cards (plan §5.2). */
export function Section({ title, action, children, testID }: { title: string; action?: { label: string; onPress: () => void }; children: ReactNode; testID?: string }) {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHeader}>
        <Text variant="overline" tone="muted" uppercase accessibilityRole="header" style={styles.flex}>{title}</Text>
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={8} style={styles.action}>
            <Text variant="subhead" tone="link" style={styles.actionText}>{action.label}</Text>
            <Icon as={ChevronRight} size="sm" color={colors.link} />
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** Grouped list surface. */
export function Group({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

export type Stat = { label: string; value: number | string; onPress?: () => void; tone?: 'default' | 'warning' | 'danger' };

/** One compact row of key numbers (not a grid of identical cards). */
export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.statRow}>
      {stats.map((s, i) => {
        const color = s.tone === 'danger' ? colors.danger : s.tone === 'warning' ? colors.warning : colors.text;
        const body = (
          <>
            <Text variant="title" maxFontSizeMultiplier={maxFontScale.dense} style={{ color }}>{String(s.value)}</Text>
            <Text variant="caption" tone="muted" maxFontSizeMultiplier={maxFontScale.dense} numberOfLines={2} style={styles.statLabel}>{s.label}</Text>
          </>
        );
        return (
          <View key={s.label} style={[styles.stat, i > 0 && styles.statDivider]}>
            {s.onPress ? (
              <Pressable onPress={s.onPress} accessibilityRole="button" accessibilityLabel={`${s.value} ${s.label}`} style={styles.statPress}>
                {body}
              </Pressable>
            ) : (
              <View accessible accessibilityLabel={`${s.value} ${s.label}`} style={styles.statPress}>{body}</View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginTop: spacing.xl },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 28 },
  flex: { flex: 1 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actionText: { fontWeight: '600' },
  group: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  statRow: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radii.lg, paddingVertical: spacing.md },
  stat: { flex: 1 },
  statDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  statPress: { alignItems: 'center', gap: 2, paddingHorizontal: 2, minHeight: 44, justifyContent: 'center' },
  statLabel: { textAlign: 'center', fontSize: 11, fontWeight: '600' },
});
