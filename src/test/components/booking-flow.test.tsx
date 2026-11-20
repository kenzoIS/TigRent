import path from 'path';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import type { SessionState } from '@/features/auth/route-resolver';
import { __setSessionForTests } from '@/features/auth/session';
import { addDays, todayInBusinessTz } from '@/lib/dates';
import { AppError, fail, ok } from '@/lib/errors';
import { paymentProvider } from '@/providers/payments/mock';
import { bookingFlowRepository, discoveryRepository, type BookingDetail, type RequestInboxRow, type SessionContext } from '@/repositories';

jest.mock('@/repositories', () => ({
  trustRepository: { prompts: jest.fn(async () => ({ ok: true, data: [] })), bookingReviews: jest.fn(async () => ({ ok: true, data: { canReview: false, reviewUntil: null, mine: null, theirs: null } })) },
  bookingFlowRepository: { request: jest.fn(), decide: jest.fn(), detail: jest.fn(), inbox: jest.fn(), extensionInbox: jest.fn(async () => ({ ok: true, data: [] })), sweep: jest.fn() },
  discoveryRepository: { listing: jest.fn(), quote: jest.fn() },
  termsRepository: { listActive: jest.fn(async () => ({ ok: true, data: [{ id: 't3', docType: 'rental_terms', version: 1, title: 'Standard TigRent Rental Terms (prototype)', content: 'Prototype terms text.', isSample: true }] })) },
  notificationInboxRepository: { unreadCount: jest.fn(async () => ({ ok: true, data: 0 })) },
  profilesRepository: { updateMine: jest.fn() },
}));
jest.mock('@/providers/payments/mock', () => ({
  ...jest.requireActual('@/providers/payments/mock'),
  paymentProvider: { id: 'mock', label: 'Demo payment', isSimulated: true, payBooking: jest.fn() },
}));

const APP_DIR = path.resolve(__dirname, '../../app');
const repo = jest.mocked(bookingFlowRepository);
const discovery = jest.mocked(discoveryRepository);
const pay = jest.mocked(paymentProvider.payBooking);
const TODAY = todayInBusinessTz();
const NOW = new Date().toISOString();
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

function signIn(userId: string, roles: SessionContext['roles'] = ['borrower', 'lender']) {
  const state: SessionState = { kind: 'signed_in', roles, verification: 'verified', accountStatus: 'active', termsAccepted: true, activeRole: 'borrower' };
  __setSessionForTests(state, { context: { userId, fullName: 'Bea Santos', accountStatus: 'active', statusReason: null, activeRolePref: 'borrower', roles, verificationStatus: 'verified', pendingTerms: [] } });
}

const detail = (o: Partial<BookingDetail> = {}): BookingDetail => ({
  id: 'b1', myRole: 'borrower', status: 'pending_lender_approval', listingId: 'l1', listingStatus: 'active',
  pickupDate: addDays(TODAY, 7), returnDate: addDays(TODAY, 9), rentalDays: 3, dueAt: `${addDays(TODAY, 9)}T15:59:00.000Z`, pickupArrangement: null,
  snapshot: { listingTitle: 'Casio fx-991EX scientific calculator', categoryLabel: 'Calculators', condition: 'like_new', pickupPoint: 'Library entrance', pickupNotes: null, coverPath: null, returnDueTimeLocal: '23:59', policyLabel: 'Sample cancellation policy v1', policyIsSample: true },
  dailyRate: 4000, subtotal: 12000, deposit: 30000, total: 42000, lateFeePerDay: 2000, commissionBps: 1000, commission: 1200, lenderNet: 10800,
  holdExpiresAt: null, serverNow: NOW, fetchedAtMs: Date.now(), decisionReason: null, cancelReason: null, createdAt: NOW, conflict: null,
  counterpart: { id: 'u2', role: 'lender', fullName: 'Leo Reyes', isStudentVerified: true, ratingAvg: 4.5, ratingCount: 2 },
  terms: { title: 'Standard TigRent Rental Terms (prototype)', version: 1, isSample: true, acceptedAt: NOW },
  events: [{ fromStatus: null, toStatus: 'pending_lender_approval', kind: null, meta: {}, reason: 'Borrower sent a request', byMe: true, at: NOW }],
  payments: [],
  activatedAt: null, returnedAt: null, completedAt: null, handoverOpensOn: addDays(TODAY, 6), lateDaysNow: 0, conversationId: 'c1',
  handover: null, returnInfo: null, extensions: [], refunds: [], lateFeeNow: 0, dispute: null,
  ...o,
});
const asLender = (o: Partial<BookingDetail> = {}) =>
  detail({ myRole: 'lender', counterpart: { id: 'u1', role: 'borrower', fullName: 'Bea Santos', isStudentVerified: true, ratingAvg: null, ratingCount: 0 }, ...o });
const inboxRow = (o: Partial<RequestInboxRow>): RequestInboxRow => ({
  id: 'b1', listingId: 'l1', listingTitle: 'Casio fx-991EX scientific calculator', coverPath: null, borrowerName: 'Bea Santos', pickupDate: addDays(TODAY, 7),
  returnDate: addDays(TODAY, 9), rentalDays: 3, subtotal: 12000, lenderNet: 10800, status: 'pending_lender_approval', holdExpiresAt: null, createdAt: NOW, conflict: null, ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
});
afterAll(() => __setSessionForTests(null));

describe('borrower sends a request', () => {
  const pickup = addDays(TODAY, 7);
  const ret = addDays(TODAY, 9);
  beforeEach(() => {
    discovery.listing.mockResolvedValue(ok({
      id: 'l1', lenderId: 'u2', title: 'Casio fx-991EX scientific calculator', description: '', categoryLabel: 'Calculators', condition: 'like_new', equipmentNotes: null,
      dailyRate: 4000, deposit: 30000, lateFeePerDay: 2000, pickupPointLabel: 'Library entrance', pickupNotes: null, status: 'active', images: [],
    }));
    discovery.quote.mockResolvedValue(ok({ rentalDays: 3, dailyRate: 4000, subtotal: 12000, deposit: 30000, total: 42000, lateFeePerDay: 2000, dueAt: '', returnDueTimeLocal: '23:59', available: true, policyVersion: 1, rentalTermsVersionId: 't3' }));
  });

  it('needs the terms accepted, then sends the snapshot inputs and opens the new booking', async () => {
    signIn('u1');
    repo.request.mockResolvedValue(ok('b-new'));
    repo.detail.mockResolvedValue(ok(detail({ id: 'b-new' })));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: `/explore/request/l1?pickup=${pickup}&ret=${ret}` });
    expect(await screen.findByText('Accept the rental terms first.')).toBeOnTheScreen();
    expect(screen.getByTestId('send-request')).toBeDisabled();
    await user.type(screen.getByTestId('pickup-note'), 'After my 1 PM class');
    await user.press(screen.getByText('I accept the rental terms, the price above and the return date.'));
    await user.press(screen.getByTestId('send-request'));
    expect(repo.request).toHaveBeenCalledWith({ listingId: 'l1', pickup, ret, termsVersionId: 't3', expectedTotal: 42000, pickupArrangement: 'After my 1 PM class' });
    await waitFor(() => expect(screen).toHavePathname('/booking/b-new'));
    expect(await screen.findByText('Request sent')).toBeOnTheScreen();
    expect(screen.getByText('Waiting for lender')).toBeOnTheScreen();
  });

  it('blocks phone numbers in the note and shows server conflicts', async () => {
    signIn('u1');
    repo.request.mockResolvedValue(fail(new AppError('conflict', 'The price changed while you were reviewing. Check the new total and send again.', 'price_changed')));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: `/explore/request/l1?pickup=${pickup}&ret=${ret}` });
    await user.press(await screen.findByText('I accept the rental terms, the price above and the return date.'));
    await user.type(screen.getByTestId('pickup-note'), 'Text 0917 123 4567');
    expect(screen.getByText('Fix the pickup note first.')).toBeOnTheScreen();
    await user.clear(screen.getByTestId('pickup-note'));
    await user.press(screen.getByTestId('send-request'));
    expect(await screen.findByText(/The price changed while you were reviewing/)).toBeOnTheScreen();
    // The terms must be re-accepted against the refreshed price.
    expect(screen.getByTestId('send-request')).toBeDisabled();
  });
});

describe('lender decides', () => {
  it('inbox lists new requests with conflicts, holds and recent decisions', async () => {
    signIn('u2', ['lender']);
    repo.inbox.mockResolvedValue(ok([
      inboxRow({ id: 'b1' }),
      inboxRow({ id: 'b2', borrowerName: 'Dana Cruz', conflict: 'dates_taken' }),
      inboxRow({ id: 'b3', status: 'awaiting_payment', holdExpiresAt: inMinutes(10) }),
      inboxRow({ id: 'b4', status: 'rejected' }),
    ]));
    repo.detail.mockResolvedValue(ok(asLender()));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/lender/requests' });
    expect(await screen.findByText('New requests (2)')).toBeOnTheScreen();
    expect(screen.getByText(/Dates no longer available/)).toBeOnTheScreen();
    expect(screen.getByText('Waiting for payment')).toBeOnTheScreen();
    expect(screen.getByText('You declined')).toBeOnTheScreen();
    await user.press(screen.getByTestId('request-b1'));
    expect(screen).toHavePathname('/booking/b1');
  });

  it('accepts after confirming, showing the earnings split', async () => {
    signIn('u2', ['lender']);
    repo.detail.mockResolvedValueOnce(ok(asLender())).mockResolvedValue(ok(asLender({ status: 'awaiting_payment', holdExpiresAt: inMinutes(15) })));
    repo.decide.mockResolvedValue(ok({ status: 'awaiting_payment', holdExpiresAt: inMinutes(15), repeated: false }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByText('Needs your decision')).toBeOnTheScreen();
    expect(screen.getByText('Platform commission (10%)')).toBeOnTheScreen();
    expect(screen.getByText('₱108.00')).toBeOnTheScreen();
    await user.press(screen.getByTestId('accept-request'));
    await user.press(await screen.findByTestId('accept-dialog-confirm'));
    expect(repo.decide).toHaveBeenCalledWith('b1', 'accept');
    expect(await screen.findByText('Waiting for payment')).toBeOnTheScreen();
    expect(screen.getByTestId('hold-timer')).toBeOnTheScreen();
  });

  it('explains a conflict and only allows declining, with a reason', async () => {
    signIn('u2', ['lender']);
    repo.detail.mockResolvedValue(ok(asLender({ conflict: 'dates_taken' })));
    repo.decide.mockResolvedValue(ok({ status: 'rejected', holdExpiresAt: null, repeated: false }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByTestId('request-conflict')).toBeOnTheScreen();
    expect(screen.getByTestId('accept-request')).toBeDisabled();
    await user.press(screen.getByTestId('reject-request'));
    await user.press(await screen.findByTestId('confirm-reject'));
    expect(await screen.findByText('Give the borrower a short reason.')).toBeOnTheScreen();
    expect(repo.decide).not.toHaveBeenCalled();
    await user.press(screen.getByText('I need the item myself on those dates.'));
    await user.press(screen.getByTestId('confirm-reject'));
    expect(repo.decide).toHaveBeenCalledWith('b1', 'reject', 'I need the item myself on those dates.');
  });
});

describe('demo checkout', () => {
  const awaiting = () => detail({ status: 'awaiting_payment', holdExpiresAt: inMinutes(15) });

  it('booking detail sends the borrower to checkout while the hold runs', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(awaiting()));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByText(/left to pay/)).toBeOnTheScreen();
    await user.press(screen.getByTestId('go-to-checkout'));
    expect(screen).toHavePathname('/booking/b1/checkout');
    expect(await screen.findByText('Simulated checkout')).toBeOnTheScreen();
  });

  it('a double tap pays once and shows the confirmation', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(awaiting()));
    let resolve: (v: Awaited<ReturnType<typeof pay>>) => void = () => {};
    pay.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1/checkout' });
    const button = await screen.findByTestId('pay-demo');
    await user.press(button);
    await user.press(button);
    resolve(ok({ paymentId: 'p1', outcome: 'success', amount: 42000, providerRef: 'MOCK-ABC', failureReason: null, processedAt: NOW, replayed: false, bookingStatus: 'confirmed' }));
    expect(await screen.findByTestId('payment-success')).toBeOnTheScreen();
    expect(pay).toHaveBeenCalledTimes(1);
    expect(pay).toHaveBeenCalledWith({ bookingId: 'b1', idempotencyKey: expect.stringMatching(/^checkout:/), scenario: 'success' });
    expect(screen.getByText(/Reference MOCK-ABC/)).toBeOnTheScreen();
  });

  it('a simulated failure releases the hold', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(awaiting()));
    pay.mockResolvedValue(ok({ paymentId: 'p2', outcome: 'failure', amount: 42000, providerRef: 'MOCK-DEF', failureReason: 'Demo payment declined', processedAt: NOW, replayed: false, bookingStatus: 'cancelled' }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1/checkout' });
    await user.press(await screen.findByText('Simulate failure'));
    await user.press(screen.getByTestId('pay-demo'));
    expect(pay).toHaveBeenCalledWith(expect.objectContaining({ scenario: 'failure' }));
    expect(await screen.findByTestId('payment-failed')).toBeOnTheScreen();
    expect(screen.getByText(/hold was released. Nothing was charged/)).toBeOnTheScreen();
  });

  it('an expired hold shows the expired state, with nothing to pay', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(detail({ status: 'payment_expired', holdExpiresAt: inMinutes(-1) })));
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1/checkout' });
    expect(await screen.findByTestId('payment-expired')).toBeOnTheScreen();
    expect(screen.queryByTestId('pay-demo')).not.toBeOnTheScreen();
  });

  it('the receipt is labelled as simulated and shows the lender split to the lender', async () => {
    signIn('u2', ['lender']);
    repo.detail.mockResolvedValue(ok(asLender({
      status: 'confirmed',
      payments: [
        { id: 'p0', purpose: 'booking', status: 'failed', amount: 42000, provider: 'mock', providerRef: 'MOCK-OLD', failureReason: 'Demo payment declined (simulated failure). No money moved.', processedAt: NOW, createdAt: NOW },
        { id: 'p1', purpose: 'booking', status: 'succeeded', amount: 42000, provider: 'mock', providerRef: 'MOCK-ABC', failureReason: null, processedAt: NOW, createdAt: NOW },
      ],
    })));
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1/receipt' });
    expect(await screen.findByTestId('receipt')).toBeOnTheScreen();
    expect(screen.getByText('Demo receipt')).toBeOnTheScreen();
    expect(screen.getByText('MOCK-ABC')).toBeOnTheScreen();
    expect(screen.getByText('Platform commission (10% of all rent)')).toBeOnTheScreen();
    expect(screen.getByTestId('attempt-failed')).toBeOnTheScreen();
  });
});
