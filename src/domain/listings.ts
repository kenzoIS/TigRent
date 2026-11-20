/**
 * Listing rules shared by the lender UI (plan §2.3, Phase 6). The server re-validates everything;
 * these give immediate, field-level feedback and keep money in integer centavos.
 */
import { z } from 'zod';
import type { ItemCondition, ListingStatus } from '@/domain/entities';
import { parsePesoInput, type Centavos } from '@/lib/money';

export const CONDITIONS: { value: ItemCondition; label: string; description: string }[] = [
  { value: 'new', label: 'New', description: 'Unused, in original packaging' },
  { value: 'like_new', label: 'Like new', description: 'Barely used, no visible wear' },
  { value: 'good', label: 'Good', description: 'Light signs of use, fully working' },
  { value: 'fair', label: 'Fair', description: 'Visible wear, fully working' },
  { value: 'worn', label: 'Worn', description: 'Heavy wear; works but shows its age' },
];

export const CONDITION_LABEL = Object.fromEntries(CONDITIONS.map((c) => [c.value, c.label])) as Record<ItemCondition, string>;

/** A Philippine mobile/landline-looking number: keep contact details in in-app messages. */
const PHONE_RE = /(\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}|\b\d{3}[\s-]\d{4}\b/;

/** Same rule as the server's app_private.has_phone_number (migration 015). */
export const hasPhoneNumber = (text: string): boolean => PHONE_RE.test(text);

const peso = (label: string, opts: { min: number; max: number; allowZero: boolean }) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${label}.`)
    .transform((v, ctx): Centavos => {
      const c = parsePesoInput(v);
      if (c === null) {
        ctx.addIssue({ code: 'custom', message: `Enter the ${label} in pesos, e.g. 120 or 120.50.` });
        return z.NEVER;
      }
      if (!opts.allowZero && c <= 0) {
        ctx.addIssue({ code: 'custom', message: `The ${label} must be more than ₱0.` });
        return z.NEVER;
      }
      if (c > opts.max) {
        ctx.addIssue({ code: 'custom', message: `That ${label} looks too high. Check the amount.` });
        return z.NEVER;
      }
      return c;
    });

const notes = (label: string) =>
  z
    .string()
    .trim()
    .max(500, `Keep ${label} under 500 characters.`)
    .refine((v) => !PHONE_RE.test(v), 'Don’t put phone numbers here. Use TigRent messages to coordinate.');

export const listingFormSchema = z
  .object({
    title: z.string().trim().min(3, 'Use at least 3 characters.').max(80, 'Use at most 80 characters.'),
    category: z.string({ error: 'Choose a category.' }).min(1, 'Choose a category.'),
    condition: z.enum(['new', 'like_new', 'good', 'fair', 'worn'], { error: 'Choose the item’s condition.' }),
    description: z.string().trim().max(2000, 'Keep the description under 2,000 characters.'),
    equipmentNotes: notes('equipment notes'),
    dailyRate: peso('daily rate', { min: 1, max: 10_000_000, allowZero: false }),
    deposit: peso('deposit', { min: 0, max: 100_000_000, allowZero: true }),
    lateFeePerDay: peso('late fee', { min: 0, max: 10_000_000, allowZero: true }),
    pickupPointId: z.string().nullable(),
    pickupNotes: notes('pickup notes'),
  })
  .refine((v) => Boolean(v.pickupPointId) || v.pickupNotes.length > 0, {
    path: ['pickupPointId'],
    message: 'Choose a pickup point or describe a safe campus meeting place.',
  });

export type ListingFormInput = z.input<typeof listingFormSchema>;
export type ListingFormValues = z.output<typeof listingFormSchema>;

/** Steps of the create/edit flow and the fields each one owns (for step-level validation). */
export const WIZARD_STEPS = [
  { key: 'basics', title: 'About the item', fields: ['title', 'category', 'condition', 'description', 'equipmentNotes'] },
  { key: 'pricing', title: 'Price and deposit', fields: ['dailyRate', 'deposit', 'lateFeePerDay'] },
  { key: 'pickup', title: 'Pickup and return', fields: ['pickupPointId', 'pickupNotes'] },
] as const;

/** RPC payload (snake_case, centavos). */
export function toListingPayload(v: ListingFormValues) {
  return {
    title: v.title,
    category: v.category,
    condition: v.condition,
    description: v.description,
    equipment_notes: v.equipmentNotes || null,
    daily_rate: v.dailyRate,
    deposit: v.deposit,
    late_fee_per_day: v.lateFeePerDay,
    pickup_point_id: v.pickupPointId,
    pickup_notes: v.pickupNotes || null,
  };
}

/** Centavos → editable peso text ("120" or "120.50"). */
export function centavosToInput(c: Centavos): string {
  return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2);
}

export type PublishCheck = { key: string; label: string; done: boolean };

/** What must be true before a listing can go live (mirrors set_listing_status checks). */
export function publishChecklist(l: { dailyRate: Centavos; title: string; moderationStatus: string }, photoCount: number, lenderReady: boolean): PublishCheck[] {
  return [
    { key: 'details', label: 'Title, category, condition and pickup set', done: l.title.trim().length >= 3 },
    { key: 'rate', label: 'Daily rate above ₱0', done: l.dailyRate > 0 },
    { key: 'photos', label: 'At least one photo', done: photoCount > 0 },
    { key: 'lender', label: 'Your account can publish (verified, in good standing)', done: lenderReady },
    { key: 'moderation', label: 'Not hidden by a moderator', done: l.moderationStatus !== 'hidden' },
  ];
}

/** Allowed next statuses from the lender's side (server enforces the same rules). */
export function nextStatuses(s: ListingStatus): ListingStatus[] {
  switch (s) {
    case 'draft':
      return ['active', 'removed'];
    case 'active':
      return ['paused', 'unavailable', 'removed'];
    case 'paused':
    case 'unavailable':
      return ['active', 'removed'];
    case 'removed':
      return [];
  }
}

export type ListingSort = 'updated' | 'price_asc' | 'price_desc' | 'title';

export function filterAndSortListings<T extends { title: string; dailyRate: Centavos; status: ListingStatus; updatedAt: string }>(
  rows: T[],
  opts: { query: string; status: ListingStatus | 'all'; sort: ListingSort },
): T[] {
  const q = opts.query.trim().toLowerCase();
  const out = rows.filter((r) => (opts.status === 'all' ? r.status !== 'removed' : r.status === opts.status) && (!q || r.title.toLowerCase().includes(q)));
  const cmp: Record<ListingSort, (a: T, b: T) => number> = {
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    price_asc: (a, b) => a.dailyRate - b.dailyRate || a.title.localeCompare(b.title),
    price_desc: (a, b) => b.dailyRate - a.dailyRate || a.title.localeCompare(b.title),
    title: (a, b) => a.title.localeCompare(b.title),
  };
  return [...out].sort(cmp[opts.sort]);
}
