/** Borrower search filters (plan Phase 7). Pure: counted, cleared and converted for the server. */
import type { ItemCondition } from '@/domain/entities';
import type { DateOnly } from '@/lib/dates';
import { parsePesoInput, type Centavos } from '@/lib/money';

export type SearchSort = 'featured' | 'newest' | 'price_asc' | 'price_desc' | 'rating';

export type SearchFilters = {
  query: string;
  category: string | null;
  pickup: DateOnly | null;
  ret: DateOnly | null;
  minPrice: string; // peso text as typed
  maxPrice: string;
  conditions: ItemCondition[];
  trustedOnly: boolean;
  minRating: number | null;
  sort: SearchSort;
};

export const EMPTY_FILTERS: SearchFilters = {
  query: '', category: null, pickup: null, ret: null, minPrice: '', maxPrice: '', conditions: [], trustedOnly: false, minRating: null, sort: 'featured',
};

export const SORT_OPTIONS: { value: SearchSort; label: string }[] = [
  { value: 'featured', label: 'Featured first' },
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Daily rate: low to high' },
  { value: 'price_desc', label: 'Daily rate: high to low' },
  { value: 'rating', label: 'Lender rating' },
];

/** Number of filters applied (excluding keyword and sort), for the "Filters (n)" button. */
export function activeFilterCount(f: SearchFilters): number {
  return [
    f.category !== null,
    f.pickup !== null && f.ret !== null,
    f.minPrice.trim() !== '' || f.maxPrice.trim() !== '',
    f.conditions.length > 0,
    f.trustedOnly,
    f.minRating !== null,
  ].filter(Boolean).length;
}

export function clearFilters(f: SearchFilters): SearchFilters {
  return { ...EMPTY_FILTERS, query: f.query, sort: f.sort };
}

export type PriceRangeProblem = 'min_invalid' | 'max_invalid' | 'min_above_max' | null;

export function priceRange(f: SearchFilters): { min: Centavos | null; max: Centavos | null; problem: PriceRangeProblem } {
  const min = f.minPrice.trim() ? parsePesoInput(f.minPrice) : null;
  const max = f.maxPrice.trim() ? parsePesoInput(f.maxPrice) : null;
  if (f.minPrice.trim() && min === null) return { min: null, max: null, problem: 'min_invalid' };
  if (f.maxPrice.trim() && max === null) return { min: null, max: null, problem: 'max_invalid' };
  if (min !== null && max !== null && min > max) return { min, max, problem: 'min_above_max' };
  return { min, max, problem: null };
}

/** RPC arguments for search_listings. Incomplete date ranges are ignored (server requires both). */
export function toSearchArgs(f: SearchFilters, page = 0, pageSize = 30) {
  const { min, max } = priceRange(f);
  const bothDates = f.pickup !== null && f.ret !== null;
  return {
    p_query: f.query.trim() || null,
    p_category: f.category,
    p_start: bothDates ? f.pickup : null,
    p_end: bothDates ? f.ret : null,
    p_min_rate: min,
    p_max_rate: max,
    p_conditions: f.conditions.length ? f.conditions : null,
    p_trusted_only: f.trustedOnly,
    p_min_rating: f.minRating,
    p_sort: f.sort,
    p_limit: pageSize,
    p_offset: page * pageSize,
  };
}
