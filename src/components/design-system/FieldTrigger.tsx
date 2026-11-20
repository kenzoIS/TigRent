import { Pressable, StyleSheet, View } from 'react-native';
import { CircleExclamationPoint } from 'lucide-react-native';
import { colors, radii, spacing } from '@/theme';
import { Icon, type IconComponent } from './Icon';
import { Text } from './Text';

type Props = {
  label: string;
  valueText?: string;
  placeholder: string;
  icon: IconComponent;
  onPress: () => void;
  error?: string | null;
  helper?: string;
  required?: boolean;
  disabled?: boolean;
  testID?: string;
};

/** Shared tappable field shell for Select/Date controls (opens a sheet). */
export function FieldTrigger({ label, valueText, placeholder, icon, onPress, error, helper, required, disabled, testID }: Props) {
  const hasError = Boolean(error);
  return (
    <View style={styles.wrap}>
      <Text variant="subhead" style={styles.label}>
        {label}
        {required ? <Text variant="subhead" tone="muted">{'  '}Required</Text> : null}
      </Text>
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${valueText ?? 'not set'}`}
        accessibilityHint={hasError ? (error ?? undefined) : helper}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [
          styles.field,
          {
            borderColor: hasError ? colors.danger : colors.border,
            borderWidth: hasError ? 1.5 : 1,
            backgroundColor: disabled ? colors.disabledBg : pressed ? colors.surfaceSunken : colors.surface,
          },
        ]}
      >
        <Text variant="body" tone={valueText ? 'default' : 'faint'} style={styles.value} numberOfLines={1}>
          {valueText ?? placeholder}
        </Text>
        <Icon as={icon} color={colors.textMuted} />
      </Pressable>
      {hasError ? (
        <View style={styles.message} accessibilityLiveRegion="polite" role="alert">
          <Icon as={CircleExclamationPoint} size="sm" color={colors.danger} />
          <Text variant="footnote" tone="danger" style={styles.flex}>{error}</Text>
        </View>
      ) : helper ? (
        <Text variant="footnote" tone="muted">{helper}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs + 2 },
  label: { fontWeight: '500' },
  field: { minHeight: 50, borderRadius: radii.md, paddingHorizontal: spacing.md + 2, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  value: { flex: 1 },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs + 2 },
  flex: { flex: 1 },
});
