import { Pressable, StyleSheet, View } from 'react-native';
import { colors, elevation, maxFontScale, radii, spacing } from '@/theme';
import { toneColors, type Tone } from './Banner';
import { Icon, type IconComponent } from './Icon';
import { Text } from './Text';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconComponent;
  disabled?: boolean;
  testID?: string;
};

/** Toggleable filter/choice chip with lively UST tiger gold selection. */
export function Chip({ label, selected = false, onPress, icon, disabled, testID }: ChipProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        styles.chip,
        selected && elevation.low,
        {
          backgroundColor: selected ? colors.primary : pressed ? colors.surfaceSunken : colors.surface,
          borderColor: selected ? colors.primaryPressed : colors.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      {icon ? <Icon as={icon} size="sm" color={selected ? colors.ink : colors.textMuted} /> : null}
      <Text variant="subhead" maxFontSizeMultiplier={maxFontScale.control} style={{ color: selected ? colors.ink : colors.text, fontWeight: selected ? '700' : '500' }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Non-interactive status label (booking status, verification state, badges). */
export function StatusPill({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconComponent }) {
  const t = toneColors[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]} accessibilityRole="text" accessibilityLabel={label}>
      {icon ? <Icon as={icon} size={13} color={t.fg} /> : null}
      <Text variant="caption" maxFontSizeMultiplier={maxFontScale.dense} style={{ color: t.fg, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, minHeight: 36, paddingHorizontal: spacing.md + 2, borderRadius: radii.pill, borderWidth: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radii.pill },
});
