import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';
import { colors, radii, spacing } from '@/theme';
import { Icon, type IconComponent } from './Icon';
import { Text } from './Text';

type Props = {
  title: string;
  subtitle?: string;
  icon?: IconComponent;
  iconTint?: string;
  /** Right-side text value (e.g. "₱120/day"). */
  value?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  selected?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  showChevron?: boolean;
  testID?: string;
};

/** Compact row for settings, lists and selection sheets. */
export function ListRow({ title, subtitle, icon, iconTint, value, trailing, onPress, selected, disabled, destructive, showChevron, testID }: Props) {
  const interactive = Boolean(onPress);
  const content = (pressed: boolean) => (
    <View style={[styles.row, pressed && { backgroundColor: colors.surfaceSunken }]}>
      {icon ? (
        <View style={[styles.iconWrap, { backgroundColor: iconTint ?? colors.surfaceSunken }]}>
          <Icon as={icon} size="md" color={destructive ? colors.danger : colors.text} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text variant="body" tone={disabled ? 'faint' : destructive ? 'danger' : 'default'} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text variant="footnote" tone="muted" numberOfLines={3}>{subtitle}</Text> : null}
      </View>
      {value ? <Text variant="callout" tone="muted" style={styles.value} numberOfLines={1}>{value}</Text> : null}
      {trailing}
      {selected ? <Icon as={Check} color={colors.link} /> : null}
      {showChevron ?? (interactive && selected === undefined) ? <Icon as={ChevronRight} size="sm" color={colors.textFaint} /> : null}
    </View>
  );
  if (!interactive) return <View testID={testID}>{content(false)}</View>;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, value].filter(Boolean).join(', ')}
      accessibilityState={{ disabled, selected }}
    >
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.xs, borderRadius: radii.sm },
  iconWrap: { width: 34, height: 34, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  value: { maxWidth: '40%' },
});
