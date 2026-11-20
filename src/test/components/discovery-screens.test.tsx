import path from 'path';
import { renderRouter, screen } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import type { SessionState } from '@/features/auth/route-resolver';
import { __setSessionForTests } from '@/features/auth/session';
import { addDays, todayInBusinessTz } from '@/lib/dates';
import { ok } from '@/lib/errors';
import { discoveryRepository, profileSummaryRepository, type BorrowerListing, type SearchResult, type ServerQuote, type SessionContext } from '@/repositories';

jest.mock('@/repositories', () => ({
  trustRepository: { prompts: jest.fn(async () => ({ ok: true, data: [] })), bookingReviews: jest.fn(async () => ({ ok: true, data: { canReview: false, reviewUntil: null, mine: null, theirs: null } })) },
  discoveryRepository: { search: jest.fn(), categories: jest.fn(), listing: jest.fn(), requestWindow: jest.fn(), unavailableDates: jest.fn(), quote: jest.fn(), lenderListings: jest.fn(), report: jest.fn() },
  profileSummaryRepository: { get: jest.fn() },
  termsRepository: { listActive: jest.fn(async () => ({ ok: true, data: [{ id: 't3', docType: 'rental_terms', version: 1, title: 'Standard TigRent Rental Terms (prototype)', content: 'Prototype terms text.', isSample: true }] })) },
  signedListingImageUrls: jest.fn(async () => ({ ok: true, data: {} })),
  bookingsRepository: { listMine: jest.fn(async () => ({ ok: true, data: [] })) },
  discoverRepository: { featured: jest.fn(async () => ({ ok: true, data: [] })) },
  notificationInboxRepository: { unreadCount: jest.fn(async () => ({ ok: true, data: 0 })) },
  profilesRepository: { updateMine: jest.fn() },
}));

const APP_DIR = path.resolve(__dirname, '../../app');
const repo = jest.mocked(discoveryRepository);
const TODAY = todayInBusinessTz();

const result = (o: Partial<SearchResult>): SearchResult => ({
  id: 'l1', title: 'Casio fx-991EX scientific calculator', categoryLabel: 'Calculators', condition: 'like_new', dailyRate: 4000, deposit: 30000, isFeatured: true,
  coverPath: null, lenderId: 'u2', lenderName: 'Leo Reyes', lenderRating: 4.5, lenderReviews: 2, lenderTrusted: false, availableForDates: true, ...o,
});
const listing = (o: Partial<BorrowerListing> = {}): BorrowerListing => ({
  id: 'l1', lenderId: 'u2', title: 'Casio fx-991EX scientific calculator', description: 'Exam-approved.', categoryLabel: 'Calculators', condition: 'like_new',
  equipmentNotes: null, dailyRate: 4000, deposit: 30000, lateFeePerDay: 2000, pickupPointLabel: 'Library entrance', pickupNotes: null, status: 'active', images: [], ...o,
});
const quote = (o: Partial<ServerQuote> = {}): ServerQuote => ({
  rentalDays: 3, dailyRate: 4000, subtotal: 12000, deposit: 30000, total: 42000, lateFeePerDay: 2000, dueAt: '', returnDueTimeLocal: '23:59', available: true, policyVersion: 1, rentalTermsVersionId: 't3', ...o,
});

function signIn(userId = 'u1', accountStatus: SessionContext['accountStatus'] = 'active') {
  const state: SessionState = { kind: 'signed_in', roles: ['borrower', 'lender'], verification: 'verified', accountStatus, termsAccepted: true, activeRole: 'borrower' };
  __setSessionForTests(state, { context: { userId, fullName: 'Bea Santos', accountStatus, statusReason: null, activeRolePref: 'borrower', roles: ['borrower', 'lender'], verificationStatus: 'verified', pendingTerms: [] } });
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.categories.mockResolvedValue(ok([{ value: 'calculators', label: 'Calculators', icon: 'calculator' }, { value: 'photo-video', label: 'Photo & video', icon: 'camera' }]));
  repo.requestWindow.mockResolvedValue(ok({ maxRentalDays: 30, maxAdvanceDays: 90, returnDueTimeLocal: '23:59', commissionBps: 1000 }));
  repo.unavailableDates.mockResolvedValue(ok([]));
  jest.mocked(profileSummaryRepository.get).mockResolvedValue(ok({
    userId: 'u2', fullName: 'Leo Reyes', avatarPath: null, memberSince: '2026-08-01T00:00:00Z', isStudentVerified: true, completedLendings: 2, completedBorrowings: 0,
    lenderRating: { avg: 4.5, count: 2 }, borrowerRating: { avg: null, count: 0 }, badges: [{ code: 'student_verified', label: 'Student verified' }],
    trustedLender: { earned: false, ruleIsSample: true, rule: { minCompletedLendings: 5, minAvgRating: 4.5, noUnresolvedSevereDisputes: true }, progress: { studentVerified: true, accountInGoodStanding: true, completedLendings: 2, avgRating: 4.5, unresolvedSevereDisputes: 0 } },
  }));
});
afterAll(() => __setSessionForTests(null));

describe('discover and search', () => {
  it('home search and category shortcuts open search', async () => {
    signIn();
    repo.search.mockResolvedValue(ok({ rows: [result({})], total: 1 }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/borrower' });
    await user.press(await screen.findByTestId('home-category-calculators'));
    expect(screen).toHavePathname('/explore/search');
    expect(await screen.findByText(/1 item in Calculators/)).toBeOnTheScreen();
    expect(repo.search).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'calculators' }));
  });

  it('applies filters, shows the count, and clears back to the full set', async () => {
    signIn();
    repo.search.mockImplementation(async (f) => ok(f.trustedOnly ? { rows: [result({ id: 'l9', title: 'TI-84 Plus', lenderTrusted: true })], total: 1 } : { rows: [result({}), result({ id: 'l9', title: 'TI-84 Plus' })], total: 2 }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/explore/search?category=' });
    expect(await screen.findByText('2 items')).toBeOnTheScreen();
    await user.press(screen.getByTestId('open-filters'));
    // Switch toggles via onValueChange; fire it directly to avoid platform-specific press handling.
    const { fireEvent } = await import('@testing-library/react-native');
    await fireEvent(screen.getByLabelText('Verified Trusted Lenders only'), 'valueChange', true);
    await user.press(screen.getByTestId('apply-filters'));
    expect(await screen.findByText('1 item')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeOnTheScreen();
    await user.press(screen.getByTestId('clear-filters'));
    expect(await screen.findByText('2 items')).toBeOnTheScreen();
  });

  it('shows a working empty state', async () => {
    signIn();
    repo.search.mockResolvedValue(ok({ rows: [], total: 0 }));
    await renderRouter(APP_DIR, { initialUrl: '/explore/search?q=spaceship' });
    expect(await screen.findByText('No matching equipment')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Clear search and filters' })).toBeOnTheScreen();
  });
});

describe('listing detail and price preview', () => {
  it('shows the lender, then a confirmed breakdown for chosen dates, and continues to review', async () => {
    signIn();
    repo.listing.mockResolvedValue(ok(listing()));
    repo.quote.mockResolvedValue(ok(quote()));
    const pickup = addDays(TODAY, 7);
    const ret = addDays(TODAY, 9);
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: `/explore/listing/l1?pickup=${pickup}&ret=${ret}` });
    expect(await screen.findByTestId('lender-card')).toBeOnTheScreen();
    expect(screen.getByText(/2 borrower reviews/)).toBeOnTheScreen();
    expect(await screen.findByText('Confirmed by TigRent')).toBeOnTheScreen();
    expect(screen.getByText('₱40 × 3 days')).toBeOnTheScreen();
    expect(screen.getByText('₱420.00')).toBeOnTheScreen();
    expect(screen.getByText(/return day is included/)).toBeOnTheScreen();
    expect(repo.quote).toHaveBeenCalledWith('l1', pickup, ret);
    await user.press(screen.getByTestId('listing-continue'));
    expect(screen).toHavePathname('/explore/request/l1');
    expect(await screen.findByText('Review request')).toBeOnTheScreen();
    expect(screen.getByTestId('send-request')).toBeDisabled();
    expect(screen.getByText('Accept the rental terms first.')).toBeOnTheScreen();
  });

  it('blocks dates the server reports as unavailable', async () => {
    signIn();
    repo.listing.mockResolvedValue(ok(listing()));
    repo.quote.mockResolvedValue(ok(quote({ available: false })));
    await renderRouter(APP_DIR, { initialUrl: `/explore/listing/l1?pickup=${addDays(TODAY, 7)}&ret=${addDays(TODAY, 9)}` });
    expect(await screen.findByText('Those dates can’t be requested')).toBeOnTheScreen();
    expect(screen.getByTestId('listing-continue')).toBeDisabled();
  });

  it('a student cannot request their own listing', async () => {
    signIn('u2');
    repo.listing.mockResolvedValue(ok(listing()));
    await renderRouter(APP_DIR, { initialUrl: '/explore/listing/l1' });
    expect(await screen.findByText('This is your listing')).toBeOnTheScreen();
    expect(screen.queryByTestId('listing-continue')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('report-listing')).not.toBeOnTheScreen();
  });

  it('a restricted student sees why requests are paused', async () => {
    signIn('u1', 'paused_pending_review');
    repo.listing.mockResolvedValue(ok(listing()));
    repo.quote.mockResolvedValue(ok(quote()));
    await renderRouter(APP_DIR, { initialUrl: `/explore/listing/l1?pickup=${addDays(TODAY, 7)}&ret=${addDays(TODAY, 9)}` });
    expect(await screen.findByText('New requests are paused while your account is under review.')).toBeOnTheScreen();
  });

  it('reports a listing with a reason', async () => {
    signIn();
    repo.listing.mockResolvedValue(ok(listing()));
    repo.report.mockResolvedValue(ok('r1'));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/explore/listing/l1' });
    await user.press(await screen.findByTestId('report-listing'));
    await user.press(screen.getByTestId('report-send'));
    expect(screen.getByText('Choose a reason.')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Photos don’t match the item' }));
    await user.press(screen.getByTestId('report-send'));
    expect(repo.report).toHaveBeenCalledWith('l1', 'Photos don’t match the item', '');
  });
});
