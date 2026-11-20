import { useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { CircleExclamationPoint } from 'lucide-react-native';
import { colors, radii, spacing, typography } from '@/theme';
import { Icon, type IconComponent } from './Icon';
import { Text } from './Text';

export type TextFieldProps = Omit<TextInputProps, 'style' | 'editable'> & {
  label: string;
  hideLabel?: boolean;
  error?: string | null;
  helper?: string;
  required?: boolean;
  disabled?: boolean;
  leadingIcon?: IconComponent;
  /** Right-side accessory such as a show/hide toggle. */
  trailing?: ReactNode;
  ref?: Ref<TextFieldHandle>;
};

export type TextFieldHandle = ComponentRef<typeof TextInput>;

export function TextField({ label, hideLabel = false, error, helper, required, disabled, leadingIcon, trailing, multiline, onFocus, onBlur, ref, ...input }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const hasError = Boolean(error);
  const borderColor = hasError ? colors.danger : focused ? colors.focus : colors.border;

  return (
    <View style={styles.wrap}>
      {!hideLabel ? (
        <Text variant="subhead" style={styles.label} nativeID={`${label}-label`}>
          {label}
          {required ? <Text variant="subhead" tone="muted">{'  '}Required</Text> : null}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          multiline && styles.multiline,
          { borderColor, borderWidth: focused || hasError ? 1.5 : 1, backgroundColor: disabled ? colors.disabledBg : colors.surface },
        ]}
      >
        {leadingIcon ? <Icon as={leadingIcon} color={colors.textMuted} /> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hasError ? (error ?? undefined) : helper}
          accessibilityState={{ disabled }}
          editable={!disabled}
          multiline={multiline}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.primaryPressed}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, multiline && styles.inputMultiline, { color: disabled ? colors.disabledText : colors.text }]}
          {...input}
        />
        {trailing}
      </View>
      {hasError ? (
        <View style={styles.message} accessibilityLiveRegion="polite" role="alert">
          <Icon as={CircleExclamationPoint} size="sm" color={colors.danger} />
          <Text variant="footnote" tone="danger" style={styles.messageText}>
            {error}
          </Text>
        </View>
      ) : helper ? (
        <Text variant="footnote" tone="muted" style={styles.helper}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs + 2 },
  label: { color: colors.text, fontWeight: '500' },
  field: {
    minHeight: 50,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  multiline: { alignItems: 'flex-start', paddingVertical: spacing.md },
  input: { flex: 1, ...typography.body, paddingVertical: spacing.md, minHeight: 48 },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top', paddingVertical: 0 },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs + 2 },
  messageText: { flex: 1 },
  helper: {},
});
