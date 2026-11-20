import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { colors, typography, type TypographyVariant } from '@/theme';

export type TextTone = 'default' | 'muted' | 'faint' | 'link' | 'danger' | 'success' | 'warning' | 'onInk' | 'onGold';

const toneColor: Record<TextTone, string> = {
  default: colors.text,
  muted: colors.textMuted,
  faint: colors.textFaint,
  link: colors.link,
  danger: colors.danger,
  success: colors.success,
  warning: colors.warning,
  onInk: colors.textOnInk,
  onGold: colors.textOnGold,
};

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  tone?: TextTone;
  align?: 'left' | 'center' | 'right';
  uppercase?: boolean;
};

export function Text({ variant = 'body', tone = 'default', align, uppercase, style, ...rest }: TextProps) {
  const isHeading = variant === 'largeTitle' || variant === 'title' || variant === 'title2';
  return (
    <RNText
      accessibilityRole={isHeading ? 'header' : rest.accessibilityRole}
      style={[
        typography[variant],
        { color: toneColor[tone] },
        align ? { textAlign: align } : null,
        uppercase ? { textTransform: 'uppercase' } : null,
        style,
      ]}
      {...rest}
    />
  );
}
