import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Banner, Screen, ScreenHeader, Text, type IconComponent } from '@/components/design-system';
import { Icon } from '@/components/design-system/Icon';
import { colors, radii, spacing } from '@/theme';

type Props = {
  title: string;
  eyebrow?: string;
  /** Plan phase that implements this screen. */
  phase: number;
  /** What this screen will do, in plain words. */
  purpose: string;
  icon: IconComponent;
  withTabBar?: boolean;
  compact?: boolean;
  /** Working controls that already exist for this screen (e.g. sign out). */
  children?: ReactNode;
};

/**
 * Honest navigation scaffold (plan Phase 1: "routes can initially render simple labelled
 * scaffolds; do not simulate finished data"). Contains no operational-looking controls.
 */
export function PhaseScaffold({ title, eyebrow, phase, purpose, icon, withTabBar, compact, children }: Props) {
  return (
    <Screen withTabBar={withTabBar}>
      <ScreenHeader title={title} eyebrow={eyebrow} size={compact ? 'compact' : 'large'} back={compact ? true : undefined} />
      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <Icon as={icon} size="xl" color={colors.link} />
        </View>
        <Text variant="callout" tone="muted">{purpose}</Text>
        <Banner tone="neutral" title={`Arrives in Phase ${phase}`} message="This is a navigation placeholder. Nothing on this screen is connected yet." />
        {children}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg, paddingTop: spacing.md },
  iconWrap: { width: 56, height: 56, borderRadius: radii.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
