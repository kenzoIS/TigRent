/**
 * TigRent design tokens (plan §5.1–5.2).
 * UST-inspired black/gold palette derived from the BMC presentation and the supplied Tiggy artwork.
 * These are NOT official UST brand tokens.
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const palette = {
  ink: '#17150F',
  inkSoft: '#2B2720',
  gold: '#D4A21E',
  goldPressed: '#B98A12',
  goldDeep: '#7F5C0B', // gold for text/links on light surfaces (AA on cream & paper)
  goldSoft: '#F5E9C6',
  cream: '#FBF7EE',
  creamDeep: '#F3ECDC',
  paper: '#FFFFFF',
  tigerAmber: '#E8891B',
  bandanaRed: '#B8443A', // secondary accent taken from Tiggy's bandana (decision D8)
  mutedText: '#665F53',
  faintText: '#8A8375', // placeholders / disabled labels only (not body copy)
  divider: '#E6DECD',
  success: '#2D7A4D',
  successSoft: '#E3F1E8',
  warning: '#9A5B00',
  warningSoft: '#FBEFD9',
  danger: '#B3261E',
  dangerSoft: '#F9E4E2',
  info: '#2F5D8A',
  infoSoft: '#E4EDF6',
  overlay: 'rgba(23,21,15,0.45)',
} as const;

export const colors = {
  background: palette.cream,
  surface: palette.paper,
  surfaceSunken: palette.creamDeep,
  text: palette.ink,
  textMuted: palette.mutedText,
  textFaint: palette.faintText,
  textOnGold: palette.ink,
  textOnInk: palette.cream,
  link: palette.goldDeep,
  primary: palette.gold,
  primaryPressed: palette.goldPressed,
  primarySoft: palette.goldSoft,
  accent: palette.tigerAmber,
  accentSecondary: palette.bandanaRed,
  border: palette.divider,
  borderStrong: '#CFC4AD',
  focus: palette.goldDeep,
  success: palette.success,
  successSoft: palette.successSoft,
  warning: palette.warning,
  warningSoft: palette.warningSoft,
  danger: palette.danger,
  dangerSoft: palette.dangerSoft,
  info: palette.info,
  infoSoft: palette.infoSoft,
  disabledBg: '#ECE6D9',
  disabledText: '#8A8375',
  overlay: palette.overlay,
  ink: palette.ink,
  inkSoft: palette.inkSoft,
} as const;

/** 4-pt spacing scale. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

/** Horizontal gutter used by every screen. */
export const gutter = spacing.lg;

export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** Minimum touch target (iOS HIG 44pt / Material 48dp → use 48). */
export const touchTarget = 48;

export const iconSize = { sm: 16, md: 20, lg: 24, xl: 32 } as const;
export const iconStroke = 1.75;

const fontFamily = Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' });
const fontFamilyMedium = Platform.select({ ios: 'System', android: 'sans-serif-medium', default: 'System' });

type TypeStyle = Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontWeight' | 'letterSpacing' | 'fontFamily'>;

export const typography = {
  largeTitle: { fontFamily, fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontFamily, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 },
  title2: { fontFamily, fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.2 },
  headline: { fontFamily: fontFamilyMedium, fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.1 },
  body: { fontFamily, fontSize: 16, lineHeight: 23, fontWeight: '400' },
  bodyStrong: { fontFamily: fontFamilyMedium, fontSize: 16, lineHeight: 23, fontWeight: '600' },
  callout: { fontFamily, fontSize: 15, lineHeight: 21, fontWeight: '400' },
  subhead: { fontFamily, fontSize: 14, lineHeight: 19, fontWeight: '400' },
  footnote: { fontFamily, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontFamily: fontFamilyMedium, fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.1 },
  overline: { fontFamily: fontFamilyMedium, fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8 },
} as const satisfies Record<string, TypeStyle>;

export type TypographyVariant = keyof typeof typography;

/** Restrained, warm-tinted elevation. */
export const elevation = {
  none: {},
  low: {
    shadowColor: '#3A2C0A',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  mid: {
    shadowColor: '#3A2C0A',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  high: {
    shadowColor: '#3A2C0A',
    shadowOpacity: 0.16,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
} as const satisfies Record<string, ViewStyle>;

/** Motion durations in ms; all nonessential motion is skipped under reduced motion. */
export const motion = {
  fast: 140,
  base: 220,
  slow: 320,
  sheet: 280,
  ambientCycle: 18000,
} as const;

/** Upper bound on font scaling for dense controls; body text scales freely. */
export const maxFontScale = { control: 1.6, dense: 1.4 } as const;

export const theme = { palette, colors, spacing, gutter, radii, touchTarget, iconSize, iconStroke, typography, elevation, motion, maxFontScale };
export type Theme = typeof theme;
