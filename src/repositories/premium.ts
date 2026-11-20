import { getSupabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import type { ListingStatus } from '@/domain/entities';
import { run, runMaybe } from './base';

export type PremiumStatus = 'inactive' | 'active' | 'cancelled' | 'expired' | 'payment_failed';
export type PremiumInfo = { id: string | null; status: PremiumStatus; price: number; periodStart: string | null; periodEnd: string | null; isActive: boolean; isSample: boolean };
export type LenderAnalytics = { completedRentals: number; activeListings: number; featuredListings: number; grossRent: number; estimatedNet: number; isSimulated: boolean };
export type AuditRow = { id: number; action: string; entityType: string; entityId: string | null; metadata: unknown; createdAt: string; actorName: string | null };

const obj = (v: unknown) => (v ?? {}) as Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

export const premiumRepository = {
  mine: () => run(getSupabase().rpc('get_my_premium'), (json): PremiumInfo => {
    const r = obj(json);
    return { id: typeof r.id === 'string' ? r.id : null, status: (r.status ?? 'inactive') as PremiumStatus, price: n(r.price), periodStart: typeof r.period_start === 'string' ? r.period_start : null, periodEnd: typeof r.period_end === 'string' ? r.period_end : null, isActive: r.is_active === true, isSample: r.is_sample === true };
  }),
  subscribe: (key: string, scenario: 'success' | 'failure') => run(getSupabase().rpc('subscribe_premium_demo', { p_idempotency_key: key, p_scenario: scenario }), (json) => obj(json)),
  cancel: () => run(getSupabase().rpc('cancel_premium'), (json) => obj(json)),
  analytics: () => run(getSupabase().rpc('get_lender_analytics'), (json): LenderAnalytics => {
    const r = obj(json);
    return { completedRentals: n(r.completed_rentals), activeListings: n(r.active_listings), featuredListings: n(r.featured_listings), grossRent: n(r.gross_rent), estimatedNet: n(r.estimated_net), isSimulated: r.is_simulated === true };
  }),
  setFeatured: (listingId: string, enabled: boolean) => run(getSupabase().rpc('set_featured_listing', { p_listing_id: listingId, p_enabled: enabled }), (json) => obj(json)),
  updateSetting: (key: string, value: unknown, description: string, isSample = true) => run(getSupabase().rpc('update_platform_setting', { p_key: key, p_value: value as Json, p_description: description, p_is_sample: isSample }), (json) => obj(json)),
  policies: () => run(getSupabase().from('cancellation_policy_versions').select('id, version, label, rules, is_sample, is_active, created_at').order('version', { ascending: false }), (rows) => rows),
  createPolicy: (label: string, rules: unknown, isSample = true) => run(getSupabase().rpc('create_cancellation_policy', { p_label: label.trim(), p_rules: rules as Json, p_is_sample: isSample }), (json) => obj(json)),
  audit: () => run(getSupabase().rpc('list_audit_log'), (rows) => rows.map((r): AuditRow => ({ id: n(r.id), action: r.action ?? '', entityType: r.entity_type ?? '', entityId: r.entity_id, metadata: r.metadata, createdAt: r.created_at ?? '', actorName: r.actor_name }))),
  markFeatured: (listingId: string, enabled: boolean) => runMaybe(getSupabase().rpc('set_featured_listing', { p_listing_id: listingId, p_enabled: enabled }), () => true),
  bulkSetListingStatus: (listingIds: string[], status: Extract<ListingStatus, 'paused' | 'unavailable'>) =>
    run(getSupabase().rpc('bulk_set_listing_status', { p_listing_ids: listingIds, p_status: status }), (count) => Number(count)),
};
