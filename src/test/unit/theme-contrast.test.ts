import { colors, contrastRatio, palette } from '@/theme';

/** Plan §5.1: check color contrast for text, disabled states and controls (WCAG AA). */
const AA = 4.5;
const AA_LARGE_OR_UI = 3;

const textPairs: [string, string, string][] = [
  ['text on background', colors.text, colors.background],
  ['text on surface', colors.text, colors.surface],
  ['text on sunken', colors.text, colors.surfaceSunken],
  ['muted on background', colors.textMuted, colors.background],
  ['muted on surface', colors.textMuted, colors.surface],
  ['muted on sunken', colors.textMuted, colors.surfaceSunken],
  ['link on background', colors.link, colors.background],
  ['link on surface', colors.link, colors.surface],
  ['link on primarySoft', colors.link, colors.primarySoft],
  ['text on gold button', colors.textOnGold, colors.primary],
  ['text on pressed gold', colors.textOnGold, colors.primaryPressed],
  ['text on tonal button', colors.text, colors.primarySoft],
  ['on-ink text', colors.textOnInk, colors.ink],
  ['white on danger button', '#FFFFFF', colors.danger],
  ['danger on background', colors.danger, colors.background],
  ['danger on dangerSoft', colors.danger, colors.dangerSoft],
  ['success on successSoft', colors.success, colors.successSoft],
  ['warning on warningSoft', colors.warning, colors.warningSoft],
  ['info on infoSoft', colors.info, colors.infoSoft],
  ['disabled label on disabled bg', colors.disabledText, colors.disabledBg],
  ['muted on danger banner', colors.textMuted, colors.dangerSoft],
  ['muted on warning banner', colors.textMuted, colors.warningSoft],
];

describe('theme contrast', () => {
  it.each(textPairs)('%s meets AA for text', (label, fg, bg) => {
    // Disabled controls are exempt from AA text contrast but must stay legible (UI threshold).
    const min = label.startsWith('disabled') ? AA_LARGE_OR_UI : AA;
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  it('placeholder text is distinguishable (UI component threshold)', () => {
    expect(contrastRatio(colors.textFaint, colors.surface)).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
  });

  it('focus ring is visible against surfaces', () => {
    expect(contrastRatio(colors.focus, colors.surface)).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
    expect(contrastRatio(colors.focus, colors.background)).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
  });

  it('brand gold is never used for small text on light surfaces', () => {
    // Documented rule: gold fills buttons; goldDeep is the text/link color.
    expect(contrastRatio(palette.gold, palette.cream)).toBeLessThan(AA);
    expect(contrastRatio(palette.goldDeep, palette.cream)).toBeGreaterThanOrEqual(AA);
  });
});
