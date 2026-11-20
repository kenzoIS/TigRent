import type { LucideIcon } from 'lucide-react-native';
import { colors, iconSize, iconStroke } from '@/theme';

export type IconComponent = LucideIcon;

type Props = {
  as: LucideIcon;
  size?: keyof typeof iconSize | number;
  color?: string;
  strokeWidth?: number;
};

/** Single icon entry point: one set (lucide), one stroke weight (plan §5.2). Decorative by default. */
export function Icon({ as: Glyph, size = 'md', color = colors.text, strokeWidth = iconStroke }: Props) {
  const px = typeof size === 'number' ? size : iconSize[size];
  return (
    <Glyph
      size={px}
      color={color}
      strokeWidth={strokeWidth}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
