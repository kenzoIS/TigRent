import { activeFilterCount, clearFilters, EMPTY_FILTERS, priceRange, toSearchArgs } from '@/domain/search';

describe('search filters', () => {
  const f = { ...EMPTY_FILTERS, query: 'calc', category: 'calculators', pickup: '2026-11-25', ret: '2026-11-27', minPrice: '20', maxPrice: '100.50', conditions: ['good' as const], trustedOnly: true, minRating: 4, sort: 'price_asc' as const };

  it('counts applied filters (not keyword or sort)', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount(f)).toBe(6);
    expect(activeFilterCount({ ...EMPTY_FILTERS, pickup: '2026-11-25' })).toBe(0); // incomplete date range isn't applied
  });
  it('clearing keeps the keyword and sort', () => {
    expect(clearFilters(f)).toEqual({ ...EMPTY_FILTERS, query: 'calc', sort: 'price_asc' });
  });
  it('validates the price range in centavos', () => {
    expect(priceRange(f)).toEqual({ min: 2000, max: 10050, problem: null });
    expect(priceRange({ ...f, minPrice: 'abc' }).problem).toBe('min_invalid');
    expect(priceRange({ ...f, minPrice: '200', maxPrice: '100' }).problem).toBe('min_above_max');
  });
  it('builds server arguments; incomplete dates are ignored', () => {
    expect(toSearchArgs(f, 1)).toEqual({
      p_query: 'calc', p_category: 'calculators', p_start: '2026-11-25', p_end: '2026-11-27', p_min_rate: 2000, p_max_rate: 10050,
      p_conditions: ['good'], p_trusted_only: true, p_min_rating: 4, p_sort: 'price_asc', p_limit: 30, p_offset: 30,
    });
    expect(toSearchArgs({ ...EMPTY_FILTERS, pickup: '2026-11-25' })).toMatchObject({ p_start: null, p_end: null, p_query: null, p_conditions: null });
  });
});
