import type { AppNotification, BookingSummary, ListingSummary, PlatformSetting } from '@/domain/entities';
import { getSupabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';
import { run } from './base';
import { bookingFlowRepository } from './bookings';

const LISTING_COLUMNS = 'id, lender_id, title, category, condition, daily_rate, deposit, late_fee_per_day, status, is_featured';

type ListingRow = Pick<
  Tables<'listings'>,
  'id' | 'lender_id' | 'title' | 'category' | 'condition' | 'daily_rate' | 'deposit' | 'late_fee_per_day' | 'status' | 'is_featured'
>;

export const toListingSummary = (r: ListingRow): ListingSummary => ({
  id: r.id,
  lenderId: r.lender_id,
  title: r.title,
  category: r.category,
  condition: r.condition,
  dailyRate: r.daily_rate,
  deposit: r.deposit,
  lateFeePerDay: r.late_fee_per_day,
  status: r.status,
  isFeatured: r.is_featured,
});

export const toBookingSummary = (r: Tables<'bookings'>): BookingSummary => {
  const snapshot = (r.snapshot ?? {}) as { listing_title?: string };
  return {
    id: r.id,
    listingId: r.listing_id,
    borrowerId: r.borrower_id,
    lenderId: r.lender_id,
    // Agreed title from the booking snapshot, never the live listing (plan §2.4, Journey B.6).
    listingTitle: snapshot.listing_title ?? '',
    pickupDate: r.pickup_date,
    returnDate: r.return_date,
    rentalDays: r.rental_days,
    dueAt: r.due_at,
    status: r.status,
    total: r.total,
    deposit: r.deposit,
    subtotal: r.subtotal,
    lenderNet: r.lender_net,
    holdExpiresAt: r.hold_expires_at,
  };
};

export const toNotification = (r: Tables<'notifications'>): AppNotification => ({
  id: r.id,
  type: r.type,
  title: r.title,
  body: r.body,
  entityType: r.entity_type,
  entityId: r.entity_id,
  readAt: r.read_at,
  createdAt: r.created_at,
});

export const listingsRepository = {
  /** RLS returns only listings the viewer may see (active + verified viewer, own, party, staff). */
  listActive: (opts: { category?: string; limit?: number } = {}) => {
    let q = getSupabase().from('listings').select(LISTING_COLUMNS).eq('status', 'active');
    if (opts.category) q = q.eq('category', opts.category);
    return run(q.order('is_featured', { ascending: false }).order('published_at', { ascending: false }).limit(opts.limit ?? 50), (rows) =>
      rows.map(toListingSummary),
    );
  },
  listByLender: (lenderId: string) =>
    run(getSupabase().from('listings').select(LISTING_COLUMNS).eq('lender_id', lenderId).order('updated_at', { ascending: false }), (rows) =>
      rows.map(toListingSummary),
    ),
};

export const bookingsRepository = {
  /** Bookings where the user is borrower or lender (RLS-enforced). Lapsed holds are released first. */
  listMine: async () => {
    await bookingFlowRepository.sweep();
    return run(getSupabase().from('bookings').select('*').order('pickup_date', { ascending: false }), (rows) => rows.map(toBookingSummary));
  },
};

export const notificationsRepository = {
  listMine: (limit = 50) =>
    run(getSupabase().from('notifications').select('*').order('created_at', { ascending: false }).limit(limit), (rows) =>
      rows.map(toNotification),
    ),
  markRead: (id: string) =>
    run(getSupabase().from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).select('*').single(), toNotification),
};

export const settingsRepository = {
  listCurrent: () =>
    run(getSupabase().from('platform_settings').select('key, value, version, is_sample, description').eq('is_current', true), (rows) =>
      rows.map((r): PlatformSetting => ({ key: r.key, value: r.value, version: r.version, isSample: r.is_sample, description: r.description })),
    ),
};
