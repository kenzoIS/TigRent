import path from 'path';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import type { SessionState } from '@/features/auth/route-resolver';
import { __setSessionForTests } from '@/features/auth/session';
import { addDays, todayInBusinessTz } from '@/lib/dates';
import { ok } from '@/lib/errors';
import { paymentProvider } from '@/providers/payments/mock';
import { bookingFlowRepository, messagesRepository, type BookingDetail, type ConversationDetail, type SessionContext } from '@/repositories';

jest.mock('@/repositories', () => ({
  trustRepository: { prompts: jest.fn(async () => ({ ok: true, data: [] })), bookingReviews: jest.fn(async () => ({ ok: true, data: { canReview: false, reviewUntil: null, mine: null, theirs: null } })) },
  bookingFlowRepository: {
    detail: jest.fn(), confirmHandover: jest.fn(), submitReturn: jest.fn(), confirmCleanReturn: jest.fn(), requestExtension: jest.fn(),
    decideExtension: jest.fn(), inbox: jest.fn(async () => ({ ok: true, data: [] })), extensionInbox: jest.fn(), sweep: jest.fn(),
  },
  messagesRepository: { list: jest.fn(), get: jest.fn(), send: jest.fn(), markRead: jest.fn(async () => ({ ok: true, data: true })) },
  discoveryRepository: {
    requestWindow: jest.fn(async () => ({ ok: true, data: { maxRentalDays: 30, maxAdvanceDays: 90, returnDueTimeLocal: '23:59', commissionBps: 1000 } })),
    unavailableDates: jest.fn(async () => ({ ok: true, data: [] })),
  },
  notificationInboxRepository: { unreadCount: jest.fn(async () => ({ ok: true, data: 0 })) },
  profilesRepository: { updateMine: jest.fn() },
  signedEvidenceUrls: jest.fn(async (paths: string[]) => ({ ok: true, data: Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}`])) })),
}));
jest.mock('@/providers/payments/mock', () => ({
  ...jest.requireActual('@/providers/payments/mock'),
  paymentProvider: { id: 'mock', label: 'Demo payment', isSimulated: true, payBooking: jest.fn(), payExtension: jest.fn() },
}));

const APP_DIR = path.resolve(__dirname, '../../app');
const repo = jest.mocked(bookingFlowRepository);
const messages = jest.mocked(messagesRepository);
const payExtension = jest.mocked(paymentProvider.payExtension);
const TODAY = todayInBusinessTz();
const NOW = new Date().toISOString();
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

function signIn(userId: string, roles: SessionContext['roles'] = ['borrower', 'lender']) {
  const state: SessionState = { kind: 'signed_in', roles, verification: 'verified', accountStatus: 'active', termsAccepted: true, activeRole: 'borrower' };
  __setSessionForTests(state, { context: { userId, fullName: 'Bea Santos', accountStatus: 'active', statusReason: null, activeRolePref: 'borrower', roles, verificationStatus: 'verified', pendingTerms: [] } });
}

const detail = (o: Partial<BookingDetail> = {}): BookingDetail => ({
  id: 'b1', myRole: 'borrower', status: 'confirmed', listingId: 'l1', listingStatus: 'active',
  pickupDate: TODAY, returnDate: addDays(TODAY, 2), rentalDays: 3, dueAt: inHours(48), pickupArrangement: null,
  snapshot: { listingTitle: 'Casio fx-991EX scientific calculator', categoryLabel: 'Calculators', condition: 'like_new', pickupPoint: 'Library entrance', pickupNotes: null, coverPath: null, returnDueTimeLocal: '23:59', policyLabel: null, policyIsSample: true },
  dailyRate: 4000, subtotal: 12000, deposit: 30000, total: 42000, lateFeePerDay: 2000, commissionBps: 1000, commission: 1200, lenderNet: 10800,
  holdExpiresAt: null, serverNow: NOW, fetchedAtMs: Date.now(), decisionReason: null, cancelReason: null, createdAt: NOW, conflict: null,
  counterpart: { id: 'u2', role: 'lender', fullName: 'Leo Reyes', isStudentVerified: true, ratingAvg: 4.5, ratingCount: 2 },
  terms: null,
  events: [
    { fromStatus: null, toStatus: 'pending_lender_approval', kind: null, meta: {}, reason: null, byMe: true, at: NOW },
    { fromStatus: 'pending_lender_approval', toStatus: 'awaiting_payment', kind: null, meta: {}, reason: null, byMe: false, at: NOW },
    { fromStatus: 'awaiting_payment', toStatus: 'confirmed', kind: null, meta: {}, reason: null, byMe: true, at: NOW },
  ],
  payments: [], activatedAt: null, returnedAt: null, completedAt: null, handoverOpensOn: addDays(TODAY, -1), lateDaysNow: 0, conversationId: 'c1',
  handover: null, returnInfo: null, extensions: [], refunds: [], lateFeeNow: 0, dispute: null,
  ...o,
});
const asLender = (o: Partial<BookingDetail> = {}) =>
  detail({ myRole: 'lender', counterpart: { id: 'u1', role: 'borrower', fullName: 'Bea Santos', isStudentVerified: true, ratingAvg: null, ratingCount: 0 }, ...o });
const step = (status: BookingDetail['status']) => ok({ status, repeated: false });

beforeEach(() => jest.clearAllMocks());
afterAll(() => __setSessionForTests(null));

describe('handover', () => {
  it('the lender confirms handover with notes; the timeline shows the pickup as the current step', async () => {
    signIn('u2', ['lender']);
    repo.detail.mockResolvedValue(ok(asLender()));
    repo.confirmHandover.mockResolvedValue(step('confirmed'));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByTestId('rental-timeline')).toBeOnTheScreen();
    expect(screen.getByLabelText('Picked up: now')).toBeOnTheScreen();
    await user.press(screen.getByTestId('confirm-handover'));
    await user.type(await screen.findByTestId('handover-sheet-notes'), 'With case');
    await user.press(screen.getByTestId('handover-sheet-submit'));
    expect(repo.confirmHandover).toHaveBeenCalledWith('b1', 'With case', []);
    await waitFor(() => expect(repo.detail).toHaveBeenCalledTimes(2));
  });

  it('the borrower confirms receipt only after the lender', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(detail()));
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByTestId('confirm-handover')).toBeDisabled();
    expect(screen.getByText('The lender confirms the handover first.')).toBeOnTheScreen();
  });
});

describe('during the rental', () => {
  it('the borrower can message, ask for more days and return the item', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(detail({ status: 'active', handover: { lenderConfirmedAt: NOW, lenderNotes: null, borrowerConfirmedAt: NOW, borrowerNotes: null, photoPaths: [] } })));
    repo.submitReturn.mockResolvedValue(step('return_requested'));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByTestId('open-conversation')).toBeOnTheScreen();
    await user.press(screen.getByTestId('return-item'));
    await user.press(await screen.findByTestId('return-sheet-submit'));
    expect(repo.submitReturn).toHaveBeenCalledWith('b1', '', []);
    await user.press(screen.getByTestId('request-extension'));
    expect(screen).toHavePathname('/booking/b1/extend');
    expect(await screen.findByText('New return date')).toBeOnTheScreen();
  });

  it('an overdue rental explains the agreed late fee and blocks new extensions', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(detail({ status: 'overdue', dueAt: inHours(-30), lateDaysNow: 2 })));
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByText('Overdue by 2 days')).toBeOnTheScreen();
    expect(screen.getByTestId('request-extension')).toBeDisabled();
  });
});

describe('extensions', () => {
  const pending = { id: 'e1', status: 'pending' as const, oldReturnDate: addDays(TODAY, 2), newReturnDate: addDays(TODAY, 4), extraDays: 2, extraAmount: 8000, extraCommission: 800, holdExpiresAt: null, decisionReason: null, createdAt: NOW, conflict: null };

  it('the lender sees a conflict, can’t approve, and declines with a reason', async () => {
    signIn('u2', ['lender']);
    repo.detail.mockResolvedValue(ok(asLender({ status: 'active', extensions: [{ ...pending, conflict: 'dates_taken' }] })));
    repo.decideExtension.mockResolvedValue(ok({ status: 'rejected', holdExpiresAt: null, repeated: false }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByTestId('extension-conflict')).toBeOnTheScreen();
    expect(screen.getByText(/your share ₱72 after 10% commission/)).toBeOnTheScreen();
    expect(screen.getByTestId('approve-extension')).toBeDisabled();
    await user.press(screen.getByTestId('reject-extension'));
    await user.press(await screen.findByText('I need it back on the original date.'));
    await user.press(screen.getByTestId('confirm-reject-extension'));
    expect(repo.decideExtension).toHaveBeenCalledWith('e1', 'reject', 'I need it back on the original date.');
  });

  it('the borrower pays an approved extension once and sees the confirmation', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(detail({ status: 'active', extensions: [{ ...pending, status: 'approved_awaiting_payment', holdExpiresAt: inHours(0.25) }] })));
    let resolve: (v: Awaited<ReturnType<typeof payExtension>>) => void = () => {};
    payExtension.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1/extend' });
    expect(await screen.findByTestId('extension-timer')).toBeOnTheScreen();
    expect(screen.getByText(/Your return date stays/)).toBeOnTheScreen();
    const button = screen.getByTestId('pay-extension');
    await user.press(button);
    await user.press(button); // double tap while the first payment is in flight
    resolve(ok({ paymentId: 'p9', outcome: 'success', amount: 8000, providerRef: 'MOCK-EXT', failureReason: null, processedAt: NOW, replayed: false, bookingStatus: 'active' }));
    expect(await screen.findByTestId('extension-paid')).toBeOnTheScreen();
    expect(payExtension).toHaveBeenCalledTimes(1);
    expect(payExtension).toHaveBeenCalledWith({ extensionId: 'e1', idempotencyKey: expect.stringMatching(/^checkout:/), scenario: 'success' });
  });

  it('a pending request shows it is waiting for the lender', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(detail({ status: 'active', extensions: [pending] })));
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1/extend' });
    expect(await screen.findByText('Waiting for the lender')).toBeOnTheScreen();
    expect(screen.queryByTestId('pay-extension')).not.toBeOnTheScreen();
  });
});

describe('return inspection', () => {
  const returned = { requestedAt: NOW, borrowerNotes: 'At the library desk', borrowerPhotoPaths: [] as string[], inspectedAt: null, outcome: null, lenderNotes: null, lenderPhotoPaths: [] as string[], lateDays: 0, lateFee: 0 };
  it('the lender confirms a clean, on-time return, or can report a problem instead', async () => {
    signIn('u2', ['lender']);
    repo.detail.mockResolvedValue(ok(asLender({ status: 'return_requested', returnInfo: returned })));
    repo.confirmCleanReturn.mockResolvedValue(step('completed'));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByText('“At the library desk”')).toBeOnTheScreen();
    expect(screen.getByTestId('report-return-problem')).toBeEnabled();
    await user.press(screen.getByTestId('confirm-clean-return'));
    await user.press(await screen.findByTestId('inspect-sheet-submit'));
    expect(repo.confirmCleanReturn).toHaveBeenCalledWith('b1', '', []);
  });
  it('a late return shows the agreed late fee coming out of the deposit and can be confirmed (Phase 10)', async () => {
    signIn('u2', ['lender']);
    repo.detail.mockResolvedValue(ok(asLender({ status: 'return_requested', returnInfo: returned, lateDaysNow: 1 })));
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByText('Returned 1 day late')).toBeOnTheScreen();
    expect(screen.getByText(/1 × ₱20 = ₱20, taken from the deposit/)).toBeOnTheScreen();
    expect(screen.getByTestId('confirm-clean-return')).toBeEnabled();
  });
  it('a completed rental shows the released deposit', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(detail({ status: 'completed', returnInfo: { ...returned, inspectedAt: NOW, outcome: 'clean', borrowerPhotoPaths: ['b1/u1/a.jpg'] }, refunds: [{ id: 'r1', amount: 30000, reason: 'Deposit released', status: 'succeeded', processedAt: NOW }] })));
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByText(/₱300 refunded to you \(simulated\)/)).toBeOnTheScreen();
    expect(await screen.findByLabelText('Return photos')).toBeOnTheScreen(); // private photo via a signed URL
  });
});

describe('messages', () => {
  const convo = (o: Partial<ConversationDetail> = {}): ConversationDetail => ({
    id: 'c1', bookingId: 'b1', bookingStatus: 'active', listingTitle: 'Casio fx-991EX scientific calculator', pickupDate: TODAY, returnDate: addDays(TODAY, 2),
    myRole: 'borrower', counterpart: { id: 'u2', fullName: 'Leo Reyes' }, closedReason: null, otherLastReadAt: null,
    messages: [{ id: 'm1', body: 'See you at 10 AM', senderIsMe: false, createdAt: NOW }],
    ...o,
  });

  it('the Messages tab lists conversations with unread counts', async () => {
    signIn('u1');
    messages.list.mockResolvedValue(ok([{ conversationId: 'c1', bookingId: 'b1', bookingStatus: 'active', listingTitle: 'Casio fx-991EX scientific calculator', myRole: 'borrower', counterpartName: 'Leo Reyes', lastMessage: 'See you at 10 AM', lastMessageAt: NOW, lastSenderIsMe: false, unreadCount: 1 }]));
    messages.get.mockResolvedValue(ok(convo()));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/borrower/messages' });
    expect(await screen.findByText('Leo Reyes (1 new)')).toBeOnTheScreen();
    expect(messages.list).toHaveBeenCalledWith('borrower');
    await user.press(screen.getByTestId('conversation-c1'));
    expect(screen).toHavePathname('/messages/c1');
    expect(await screen.findByText('See you at 10 AM')).toBeOnTheScreen();
    await waitFor(() => expect(messages.markRead).toHaveBeenCalledWith('c1'));
  });

  it('sends a message and refreshes', async () => {
    signIn('u1');
    messages.get.mockResolvedValueOnce(ok(convo())).mockResolvedValue(ok(convo({ messages: [...convo().messages, { id: 'm2', body: 'Thanks!', senderIsMe: true, createdAt: NOW }] })));
    messages.send.mockResolvedValue(ok('m2'));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/messages/c1' });
    await user.type(await screen.findByTestId('message-input'), 'Thanks!');
    await user.press(screen.getByTestId('send-message'));
    expect(messages.send).toHaveBeenCalledWith('c1', 'Thanks!');
    expect(await screen.findByText('Thanks!')).toBeOnTheScreen();
  });

  it('declined bookings close the conversation', async () => {
    signIn('u1');
    messages.get.mockResolvedValue(ok(convo({ bookingStatus: 'rejected', closedReason: 'This booking was declined, so messaging is closed.' })));
    await renderRouter(APP_DIR, { initialUrl: '/messages/c1' });
    expect(await screen.findByText('This booking was declined, so messaging is closed.')).toBeOnTheScreen();
    expect(screen.queryByTestId('message-input')).not.toBeOnTheScreen();
  });
});
