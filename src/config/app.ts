/**
 * App-level presentation configuration. Business policy values (academic year, fees,
 * thresholds…) are NOT here: they live in admin-managed backend settings (plan §2, §12).
 */
export const appConfig = {
  productName: 'TigRent',
  tagline: 'Rent what you need. Lend what you don’t.',
  communityLabel: 'For the UST student community',
  mascot: {
    /** Working name from plan §5.4; rename here. */
    name: 'Tiggy',
  },
  motion: {
    /** Master switch for ambient background motion (falls back to static when off). */
    ambientEnabled: true,
  },
  /** Business timezone for date-only rental rules (plan §2.3, §10.1). */
  businessTimeZone: 'Asia/Manila',
  /** Asia/Manila is fixed UTC+8 with no DST. */
  businessUtcOffsetMinutes: 8 * 60,
} as const;
