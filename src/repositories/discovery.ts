import type { ItemCondition } from '@/domain/entities';
import { toSearchArgs, type SearchFilters } from '@/domain/search';
import type { DateOnly } from '@/lib/dates';
import { ok, fail, toAppError, type Result } from '@/lib/errors';
import type { Centavos } from '@/lib/money';
import { getSupabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';
import { run } from './base';
import type { ListingImage } from './listing-management';

export type SearchResult = {
  id: string;
  title: string;
  categoryLabel: string;
  condition: ItemCondition;
  dailyRate: Centavos;
  deposit: Centavos;
  isFeatured: boolean;
  coverPath: string | null;
  lenderId: string;
  lenderName: string;
  lenderRating: number | null;
  lenderReviews: number;
  lenderTrusted: boolean;
  availableForDates: boolean;
};

export type BorrowerListing = {
  id: string;
  lenderId: string;
  title: string;
  description: string;
  categoryLabel: string;
  condition: ItemCondition;
  equipmentNotes: string | null;
  dailyRate: Centavos;
  deposit: Centavos;
  lateFeePerDay: Centavos;
  pickupPointLabel: string | null;
  pickupNotes: string | null;
  status: Tables<'listings'>['status'];
  images: ListingImage[];
};

export type UnavailableRange = { startDate: DateOnly; endDate: DateOnly; reason: 'booked' | 'unavailable' };

export type ServerQuote = {
  rentalDays: number;
  dailyRate: Centavos;
  subtotal: Centavos;
  deposit: Centavos;
  total: Centavos;
  lateFeePerDay: Centavos;
  dueAt: string;
  returnDueTimeLocal: string;
  available: boolean;
  policyVersion: number | null;
  rentalTermsVersionId: string | null;
};

export type RequestWindow = { maxRentalDays: number; maxAdvanceDays: number; returnDueTimeLocal: string; commissionBps: number };

export const discoveryRepository = {
  search: async (filters: SearchFilters, page = 0): Promise<Result<{ rows: SearchResult[]; total: number }>> => {
    try {
      const { data, error } = await getSupabase().rpc('search_listings', toSearchArgs(filters, page));
      if (error) return fail(toAppError(error));
      const rows = (data ?? []).map(
        (r): SearchResult => ({
          id: r.id ?? '',
          title: r.title ?? '',
          categoryLabel: r.category_label ?? '',
          condition: (r.condition ?? 'good') as ItemCondition,
          dailyRate: r.daily_rate ?? 0,
          deposit: r.deposit ?? 0,
          isFeatured: r.is_featured ?? false,
          coverPath: r.cover_path,
          lenderId: r.lender_id ?? '',
          lenderName: r.lender_name ?? '',
          lenderRating: r.lender_rating === null ? null : Number(r.lender_rating),
          lenderReviews: r.lender_reviews ?? 0,
          lenderTrusted: r.lender_trusted ?? false,
          availableForDates: r.available_for_dates ?? true,
        }),
      );
      return ok({ rows, total: Number(data?.[0]?.total_count ?? 0) });
    } catch (e) {
      return fail(toAppError(e));
    }
  },

  listing: (id: string) =>
    run(
      getSupabase()
        .from('listings')
        .select('id, lender_id, title, description, condition, equipment_notes, daily_rate, deposit, late_fee_per_day, pickup_notes, status, listing_categories(label), campus_pickup_points(label), listing_images(id, path, sort_order)')
        .eq('id', id)
        .single(),
      (r): BorrowerListing => {
        const row = r as unknown as Tables<'listings'> & { listing_categories: { label: string } | null; campus_pickup_points: { label: string } | null; listing_images: Tables<'listing_images'>[] };
        return {
          id: row.id,
          lenderId: row.lender_id,
          title: row.title,
          description: row.description,
          categoryLabel: row.listing_categories?.label ?? '',
          condition: row.condition,
          equipmentNotes: row.equipment_notes,
          dailyRate: row.daily_rate,
          deposit: row.deposit,
          lateFeePerDay: row.late_fee_per_day,
          pickupPointLabel: row.campus_pickup_points?.label ?? null,
          pickupNotes: row.pickup_notes,
          status: row.status,
          images: [...(row.listing_images ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({ id: i.id, path: i.path, sortOrder: i.sort_order })),
        };
      },
    ),

  unavailableDates: (listingId: string, from: DateOnly, to: DateOnly) =>
    run(getSupabase().rpc('get_listing_unavailable_dates', { p_listing_id: listingId, p_from: from, p_to: to }), (rows) =>
      rows.map((r): UnavailableRange => ({ startDate: r.start_date ?? from, endDate: r.end_date ?? from, reason: r.reason === 'booked' ? 'booked' : 'unavailable' })),
    ),

  quote: (listingId: string, pickup: DateOnly, ret: DateOnly) =>
    run(getSupabase().rpc('quote_booking', { p_listing_id: listingId, p_pickup: pickup, p_return: ret }), (json): ServerQuote => {
      const q = json as Record<string, unknown>;
      return {
        rentalDays: q.rental_days as number,
        dailyRate: q.daily_rate as number,
        subtotal: q.subtotal as number,
        deposit: q.deposit as number,
        total: q.total as number,
        lateFeePerDay: q.late_fee_per_day as number,
        dueAt: q.due_at as string,
        returnDueTimeLocal: q.return_due_time_local as string,
        available: q.available as boolean,
        policyVersion: (q.policy_version as number | null) ?? null,
        rentalTermsVersionId: (q.rental_terms_version_id as string | null) ?? null,
      };
    }),

  lenderListings: (lenderId: string) =>
    run(
      getSupabase()
        .from('listings')
        .select('id, title, daily_rate, condition, listing_images(path, sort_order)')
        .eq('lender_id', lenderId)
        .eq('status', 'active')
        .order('published_at', { ascending: false }),
      (rows) =>
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          dailyRate: r.daily_rate,
          condition: r.condition,
          coverPath: [...(r.listing_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]?.path ?? null,
        })),
    ),

  categories: () =>
    run(getSupabase().from('listing_categories').select('slug, label, icon').eq('is_active', true).order('sort_order'), (rows) =>
      rows.map((r) => ({ value: r.slug, label: r.label, icon: r.icon })),
    ),

  requestWindow: () =>
    run(
      getSupabase().from('platform_settings').select('key, value').eq('is_current', true).in('key', ['max_rental_days', 'max_advance_days', 'return_due_time_local', 'commission_bps']),
      (rows): RequestWindow => {
        const get = (k: string) => rows.find((r) => r.key === k)?.value;
        return {
          maxRentalDays: Number(get('max_rental_days') ?? 30),
          maxAdvanceDays: Number(get('max_advance_days') ?? 90),
          returnDueTimeLocal: String(get('return_due_time_local') ?? '23:59'),
          commissionBps: Number(get('commission_bps') ?? 1000),
        };
      },
    ),

  report: (listingId: string, reason: string, details?: string) =>
    run(getSupabase().rpc('report_listing', { p_listing_id: listingId, p_reason: reason, p_details: details ?? null }), (id) => id as string),
};
