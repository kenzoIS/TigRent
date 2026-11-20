import { Pressable, StyleSheet, View } from 'react-native';
import { CircleCheck, CircleExclamationPoint, Info, TriangleExclamationPoint, X } from 'lucide-react-native';
import { colors, radii, spacing, touchTarget } from '@/theme';
import { Icon, type IconComponent } from './Icon';
import { Text } from './Text';

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export const toneColors: Record<Tone, { bg: string; fg: string; icon: IconComponent }> = {
  info: { bg: colors.infoSoft, fg: colors.info, icon: Info },
  success: { bg: colors.successSoft, fg: colors.success, icon: CircleCheck },
  warning: { bg: colors.warningSoft, fg: colors.warning, icon: TriangleExclamationPoint },
  danger: { bg: colors.dangerSoft, fg: colors.danger, icon: CircleExclamationPoint },
  neutral: { bg: colors.surfaceSunken, fg: colors.textMuted, icon: Info },
};

type BannerProps = {
  tone?: Tone;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
  onDismiss?: () => void;
  testID?: string;
};

/** Inline status message. Used for verification state, simulated-service labels, restrictions. */
export function Banner({ tone = 'info', title, message, action, onDismiss, testID }: BannerProps) {
  const t = toneColors[tone];
  return (
    <View
      testID={testID}
      style={[styles.root, { backgroundColor: t.bg }]}
      accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : 'summary'}
    >
      <Icon as={t.icon} color={t.fg} />
      <View style={styles.text}>
        <Text variant="bodyStrong" style={{ color: colors.text }}>{title}</Text>
        {message ? <Text variant="subhead" tone="muted">{message}</Text> : null}
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={8} style={styles.action}>
            <Text variant="subhead" style={{ color: t.fg, fontWeight: '600' }}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {onDismiss ? (
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel={`Dismiss: ${title}`} style={styles.dismiss}>
          <Icon as={X} size="sm" color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md + 2, borderRadius: radii.md },
  text: { flex: 1, gap: spacing.xxs },
  action: { marginTop: spacing.xs, alignSelf: 'flex-start', minHeight: 28, justifyContent: 'center' },
  dismiss: { width: touchTarget - 12, height: touchTarget - 12, alignItems: 'center', justifyContent: 'center', margin: -spacing.sm },
});
