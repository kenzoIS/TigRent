import { centavosToInput, filterAndSortListings, listingFormSchema, nextStatuses, publishChecklist, toListingPayload } from '@/domain/listings';

const valid = {
  title: 'Casio fx-991EX', category: 'calculators', condition: 'good' as const, description: '', equipmentNotes: '',
  dailyRate: '40', deposit: '300', lateFeePerDay: '20.50', pickupPointId: 'p1', pickupNotes: '',
};
const issues = (patch: Record<string, unknown>) => {
  const r = listingFormSchema.safeParse({ ...valid, ...patch });
  return r.success ? [] : r.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`);
};

describe('listing form (money in integer centavos)', () => {
  it('parses pesos into centavos and builds the RPC payload', () => {
    const r = listingFormSchema.parse(valid);
    expect(toListingPayload(r)).toMatchObject({ daily_rate: 4000, deposit: 30000, late_fee_per_day: 2050, pickup_point_id: 'p1', equipment_notes: null });
  });
  it.each([
    [{ dailyRate: '0' }, /dailyRate: The daily rate must be more than ₱0/],
    [{ dailyRate: 'abc' }, /dailyRate: Enter the daily rate in pesos/],
    [{ deposit: '-5' }, /deposit: Enter the deposit in pesos/],
    [{ lateFeePerDay: '1.234' }, /lateFeePerDay/],
    [{ title: 'ab' }, /title: Use at least 3/],
    [{ category: '' }, /category: Choose a category/],
    [{ condition: undefined }, /condition/],
    [{ pickupPointId: null, pickupNotes: '' }, /pickupPointId: Choose a pickup point or describe/],
    [{ pickupNotes: 'Text me at 0917 123 4567' }, /pickupNotes: Don’t put phone numbers here/],
  ])('rejects %o', (patch, msg) => {
    expect(issues(patch).join(' | ')).toMatch(msg);
  });
  it('allows a zero deposit and late fee, and notes-only pickup', () => {
    expect(issues({ deposit: '0', lateFeePerDay: '0', pickupPointId: null, pickupNotes: 'Library entrance after class' })).toEqual([]);
  });
  it('round-trips centavos to editable text', () => {
    expect(centavosToInput(4000)).toBe('40');
    expect(centavosToInput(2050)).toBe('20.50');
  });
});

describe('publish rules', () => {
  it('lists what is missing before publishing', () => {
    const checks = publishChecklist({ dailyRate: 4000, title: 'Calculator', moderationStatus: 'ok' }, 0, true);
    expect(checks.filter((c) => !c.done).map((c) => c.key)).toEqual(['photos']);
    expect(publishChecklist({ dailyRate: 4000, title: 'Calculator', moderationStatus: 'hidden' }, 1, false).filter((c) => !c.done).map((c) => c.key)).toEqual(['lender', 'moderation']);
  });
  it('mirrors the server’s allowed status changes', () => {
    expect(nextStatuses('draft')).toEqual(['active', 'removed']);
    expect(nextStatuses('active')).toEqual(['paused', 'unavailable', 'removed']);
    expect(nextStatuses('paused')).toEqual(['active', 'removed']);
    expect(nextStatuses('removed')).toEqual([]);
  });
});

describe('equipment search, filter and sort', () => {
  const rows = [
    { title: 'Tripod', dailyRate: 12000, status: 'active' as const, updatedAt: '2026-11-01' },
    { title: 'Calculator', dailyRate: 4000, status: 'draft' as const, updatedAt: '2026-11-10' },
    { title: 'Camera', dailyRate: 45000, status: 'active' as const, updatedAt: '2026-11-05' },
    { title: 'Old cable', dailyRate: 1000, status: 'removed' as const, updatedAt: '2026-11-12' },
  ];
  it('hides removed listings from "all" and filters by status and title', () => {
    expect(filterAndSortListings(rows, { query: '', status: 'all', sort: 'updated' }).map((r) => r.title)).toEqual(['Calculator', 'Camera', 'Tripod']);
    expect(filterAndSortListings(rows, { query: 'ca', status: 'active', sort: 'title' }).map((r) => r.title)).toEqual(['Camera']);
  });
  it('sorts by price both ways', () => {
    expect(filterAndSortListings(rows, { query: '', status: 'all', sort: 'price_asc' }).map((r) => r.title)).toEqual(['Calculator', 'Tripod', 'Camera']);
    expect(filterAndSortListings(rows, { query: '', status: 'all', sort: 'price_desc' }).map((r) => r.title)).toEqual(['Camera', 'Tripod', 'Calculator']);
  });
});
