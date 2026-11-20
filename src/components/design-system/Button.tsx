import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, maxFontScale, radii, spacing, touchTarget, typography } from '@/theme';
import { Icon, type IconComponent } from './Icon';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: IconComponent;
  trailingIcon?: IconComponent;
  loading?: boolean;
  disabled?: boolean;
  /** Shown under a disabled button so it never looks operational without explanation (plan §0.1.6). */
  disabledReason?: string;
  fullWidth?: boolean;
  haptic?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

const variantStyle: Record<ButtonVariant, { bg: string; bgPressed: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, bgPressed: colors.primaryPressed, fg: colors.textOnGold },
  secondary: { bg: colors.surface, bgPressed: colors.surfaceSunken, fg: colors.text, border: colors.borderStrong },
  tonal: { bg: colors.primarySoft, bgPressed: '#EBDDB2', fg: colors.text },
  ghost: { bg: 'transparent', bgPressed: colors.surfaceSunken, fg: colors.link },
  danger: { bg: colors.danger, bgPressed: '#8F1E18', fg: '#FFFFFF' },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  trailingIcon,
  loading = false,
  disabled = false,
  disabledReason,
  fullWidth,
  haptic = variant === 'primary' || variant === 'danger',
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const [focused, setFocused] = useState(false);
  const v = variantStyle[variant];
  const inactive = disabled || loading;
  const height = size === 'md' ? 50 : 38;

  const handlePress = () => {
    if (inactive || !onPress) return;
    if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    onPress();
  };

  return (
    <View style={[fullWidth && styles.fullWidth, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={disabled && disabledReason ? disabledReason : accessibilityHint}
        accessibilityState={{ disabled: inactive, busy: loading }}
        disabled={inactive}
        onPress={handlePress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        hitSlop={size === 'sm' ? { top: (touchTarget - height) / 2, bottom: (touchTarget - height) / 2 } : undefined}
        style={({ pressed }) => [
          styles.base,
          {
            minHeight: height,
            paddingHorizontal: size === 'md' ? spacing.xl : spacing.lg,
            backgroundColor: disabled ? colors.disabledBg : pressed ? v.bgPressed : v.bg,
            borderColor: focused ? colors.focus : disabled ? colors.disabledBg : (v.border ?? 'transparent'),
            borderWidth: focused ? 2 : v.border ? StyleSheet.hairlineWidth * 2 : 0,
            transform: [{ scale: pressed && !inactive ? 0.985 : 1 }],
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={v.fg} accessibilityElementsHidden />
        ) : (
          <View style={styles.content}>
            {icon ? <Icon as={icon} size={size === 'md' ? 'md' : 'sm'} color={disabled ? colors.disabledText : v.fg} /> : null}
            <Text
              maxFontSizeMultiplier={maxFontScale.control}
              numberOfLines={2}
              style={[size === 'md' ? typography.headline : typography.subhead, styles.label, { color: disabled ? colors.disabledText : v.fg }]}
            >
              {label}
            </Text>
            {trailingIcon ? <Icon as={trailingIcon} size="sm" color={disabled ? colors.disabledText : v.fg} /> : null}
          </View>
        )}
      </Pressable>
      {disabled && disabledReason ? (
        <Text variant="footnote" tone="muted" style={styles.reason} importantForAccessibility="no">
          {disabledReason}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fullWidth: { alignSelf: 'stretch' },
  base: { borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { fontWeight: '600', textAlign: 'center' },
  reason: { marginTop: spacing.xs },
});
