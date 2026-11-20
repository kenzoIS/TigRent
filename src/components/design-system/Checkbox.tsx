import { Pressable, StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { colors, radii, spacing } from '@/theme';
import { Icon } from './Icon';
import { Text } from './Text';

type Props = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  error?: string | null;
  disabled?: boolean;
  testID?: string;
};

export function Checkbox({ label, checked, onChange, description, error, disabled, testID }: Props) {
  return (
    <View style={styles.wrap}>
      <Pressable
        testID={testID}
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        accessibilityState={{ checked, disabled }}
        accessibilityHint={error ?? description}
        disabled={disabled}
        onPress={() => onChange(!checked)}
        style={styles.row}
        hitSlop={6}
      >
        <View
          style={[
            styles.box,
            { borderColor: error ? colors.danger : checked ? colors.ink : colors.borderStrong, backgroundColor: checked ? colors.ink : colors.surface },
          ]}
        >
          {checked ? <Icon as={Check} size={16} color={colors.textOnInk} strokeWidth={2.5} /> : null}
        </View>
        <View style={styles.text}>
          <Text variant="callout" tone={disabled ? 'faint' : 'default'}>{label}</Text>
          {description ? <Text variant="footnote" tone="muted">{description}</Text> : null}
        </View>
      </Pressable>
      {error ? <Text variant="footnote" tone="danger" accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, minHeight: 44, paddingVertical: spacing.xs },
  box: { width: 24, height: 24, borderRadius: radii.xs, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  text: { flex: 1, gap: 2 },
});
