import type { ItemCondition, ListingStatus } from '@/domain/entities';
import { AppError, fail, ok, toAppError, type Result } from '@/lib/errors';
import type { Centavos } from '@/lib/money';
import { getSupabase } from '@/lib/supabase';
import type { DateOnly } from '@/lib/dates';
import type { Tables } from '@/types/database';
import { run } from './base';

export type ListingManageRow = {
  id: string;
  title: string;
  category: string;
  condition: ItemCondition;
  dailyRate: Centavos;
  deposit: Centavos;
  status: ListingStatus;
  moderationStatus: Tables<'listings'>['moderation_status'];
  updatedAt: string;
  coverPath: string | null;
  photoCount: number;
};

export type ListingImage = { id: string; path: string; sortOrder: number };
export type AvailabilityBlock = { id: string; startDate: DateOnly; endDate: DateOnly; reason: string | null };
export type HeldRange = { bookingId: string; startDate: DateOnly; endDate: DateOnly; status: Tables<'bookings'>['status'] };

export type ListingDetail = {
  id: string;
  lenderId: string;
  title: string;
  description: string;
  category: string;
  categoryLabel: string;
  condition: ItemCondition;
  equipmentNotes: string | null;
  dailyRate: Centavos;
  deposit: Centavos;
  lateFeePerDay: Centavos;
  pickupPointId: string | null;
  pickupPointLabel: string | null;
  pickupNotes: string | null;
  status: ListingStatus;
  moderationStatus: Tables<'listings'>['moderation_status'];
  isFeatured?: boolean;
  publishedAt: string | null;
  updatedAt: string;
  images: ListingImage[];
  blocks: AvailabilityBlock[];
  held: HeldRange[];
};

const HOLDING = ['awaiting_payment', 'confirmed', 'active', 'overdue', 'return_requested', 'disputed'] as const;

type DetailRow = Tables<'listings'> & {
  listing_categories: { label: string } | null;
  campus_pickup_points: { label: string } | null;
  listing_images: Tables<'listing_images'>[];
  listing_availability: Tables<'listing_availability'>[];
};

export const listingManagementRepository = {
  listMine: (lenderId: string) =>
    run(
      getSupabase()
        .from('listings')
        .select('id, title, category, condition, daily_rate, deposit, status, moderation_status, updated_at, listing_images(path, sort_order)')
        .eq('lender_id', lenderId)
        .order('updated_at', { ascending: false }),
      (rows) =>
        rows.map((r): ListingManageRow => {
          const imgs = [...(r.listing_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
          return {
            id: r.id,
            title: r.title,
            category: r.category,
            condition: r.condition,
            dailyRate: r.daily_rate,
            deposit: r.deposit,
            status: r.status,
            moderationStatus: r.moderation_status,
            updatedAt: r.updated_at,
            coverPath: imgs[0]?.path ?? null,
            photoCount: imgs.length,
          };
        }),
    ),

  get: async (id: string): Promise<Result<ListingDetail | null>> => {
    try {
      const sb = getSupabase();
      const [{ data, error }, held] = await Promise.all([
        sb
          .from('listings')
          .select('*, listing_categories(label), campus_pickup_points(label), listing_images(*), listing_availability(*)')
          .eq('id', id)
          .maybeSingle(),
        sb.from('bookings').select('id, pickup_date, return_date, status').eq('listing_id', id).in('status', [...HOLDING]),
      ]);
      if (error) return fail(toAppError(error));
      if (held.error) return fail(toAppError(held.error));
      if (!data) return ok(null);
      const r = data as unknown as DetailRow;
      return ok({
        id: r.id,
        lenderId: r.lender_id,
        title: r.title,
        description: r.description,
        category: r.category,
        categoryLabel: r.listing_categories?.label ?? r.category,
        condition: r.condition,
        equipmentNotes: r.equipment_notes,
        dailyRate: r.daily_rate,
        deposit: r.deposit,
        lateFeePerDay: r.late_fee_per_day,
        pickupPointId: r.pickup_point_id,
        pickupPointLabel: r.campus_pickup_points?.label ?? null,
        pickupNotes: r.pickup_notes,
        status: r.status,
        moderationStatus: r.moderation_status,
        isFeatured: r.is_featured,
        publishedAt: r.published_at,
        updatedAt: r.updated_at,
        images: [...r.listing_images].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({ id: i.id, path: i.path, sortOrder: i.sort_order })),
        blocks: [...r.listing_availability]
          .sort((a, b) => a.start_date.localeCompare(b.start_date))
          .map((b) => ({ id: b.id, startDate: b.start_date, endDate: b.end_date, reason: b.reason })),
        held: (held.data ?? []).map((b) => ({ bookingId: b.id, startDate: b.pickup_date, endDate: b.return_date, status: b.status })),
      });
    } catch (e) {
      return fail(toAppError(e));
    }
  },

  categories: () =>
    run(getSupabase().from('listing_categories').select('slug, label').eq('is_active', true).order('sort_order'), (rows) =>
      rows.map((r) => ({ value: r.slug, label: r.label })),
    ),
  pickupPoints: () =>
    run(getSupabase().from('campus_pickup_points').select('id, label, description, is_sample').eq('is_active', true).order('sort_order'), (rows) =>
      rows.map((r) => ({ value: r.id, label: r.label, description: r.description, isSample: r.is_sample })),
    ),

  create: (payload: Record<string, unknown>) => run(getSupabase().rpc('create_listing', { p_fields: payload as never }), (id) => id as string),
  update: (id: string, payload: Record<string, unknown>) =>
    run(getSupabase().rpc('update_listing', { p_id: id, p_fields: payload as never }).then((r) => ({ ...r, data: r.error ? null : true })), () => undefined),
  setStatus: (id: string, status: ListingStatus) =>
    run(getSupabase().rpc('set_listing_status', { p_id: id, p_status: status }), (s) => s as ListingStatus),

  addImage: (listingId: string, path: string) => run(getSupabase().rpc('add_listing_image', { p_listing_id: listingId, p_path: path }), (id) => id as string),
  /** Removes the photo record, then the stored file (an orphaned file is harmless; a dangling record is not). */
  removeImage: async (imageId: string): Promise<Result<void>> => {
    const r = await run(getSupabase().rpc('remove_listing_image', { p_image_id: imageId }), (p) => p as string);
    if (!r.ok) return r;
    await getSupabase().storage.from('listing-images').remove([r.data]).catch(() => undefined);
    return ok(undefined);
  },
  reorderImages: (listingId: string, ids: string[]) =>
    run(getSupabase().rpc('reorder_listing_images', { p_listing_id: listingId, p_image_ids: ids }).then((r) => ({ ...r, data: r.error ? null : true })), () => undefined),

  addBlock: (listingId: string, start: DateOnly, end: DateOnly, reason?: string) =>
    run(getSupabase().rpc('add_availability_block', { p_listing_id: listingId, p_start: start, p_end: end, p_reason: reason ?? null }), (id) => id as string),
  removeBlock: (blockId: string) =>
    run(getSupabase().rpc('remove_availability_block', { p_block_id: blockId }).then((r) => ({ ...r, data: r.error ? null : true })), () => undefined),
};

/** Signed URLs for private listing photos (1 hour), keyed by path. */
export async function signedListingImageUrls(paths: string[]): Promise<Result<Record<string, string>>> {
  if (paths.length === 0) return ok({});
  try {
    const { data, error } = await getSupabase().storage.from('listing-images').createSignedUrls(paths, 3600);
    if (error) return fail(new AppError('forbidden', 'Photos couldn’t be loaded.'));
    const out: Record<string, string> = {};
    for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
    return ok(out);
  } catch (e) {
    return fail(toAppError(e));
  }
}

// ── Moderation (staff) ────────────────────────────────────────────────────
export type ListingReportItem = {
  id: string;
  listingId: string;
  listingTitle: string;
  listingModeration: Tables<'listings'>['moderation_status'];
  reason: string;
  details: string | null;
  status: Tables<'listing_reports'>['status'];
  createdAt: string;
};

export const listingModerationRepository = {
  listOpen: () =>
    run(
      getSupabase()
        .from('listing_reports')
        .select('id, listing_id, reason, details, status, created_at, listings(title, moderation_status)')
        .in('status', ['open', 'reviewing'])
        .order('created_at'),
      (rows) =>
        rows.map((r): ListingReportItem => {
          const l = r.listings as unknown as { title: string; moderation_status: Tables<'listings'>['moderation_status'] } | null;
          return {
            id: r.id,
            listingId: r.listing_id,
            listingTitle: l?.title ?? 'Listing',
            listingModeration: l?.moderation_status ?? 'reported',
            reason: r.reason,
            details: r.details,
            status: r.status,
            createdAt: r.created_at,
          };
        }),
    ),
  listHidden: () =>
    run(getSupabase().from('listings').select('id, title, updated_at').eq('moderation_status', 'hidden').order('updated_at', { ascending: false }), (rows) =>
      rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at })),
    ),
  resolve: (reportId: string, action: 'dismiss' | 'hide', note?: string) =>
    run(getSupabase().rpc('resolve_listing_report', { p_report_id: reportId, p_action: action, p_note: note ?? null }).then((r) => ({ ...r, data: r.error ? null : true })), () => undefined),
  restore: (listingId: string, note: string) =>
    run(getSupabase().rpc('restore_listing', { p_listing_id: listingId, p_note: note }).then((r) => ({ ...r, data: r.error ? null : true })), () => undefined),
};
