import path from 'path';
import { renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import type { SessionState } from '@/features/auth/route-resolver';
import { __setSessionForTests } from '@/features/auth/session';
import { addDays, todayInBusinessTz } from '@/lib/dates';
import { AppError, fail, ok } from '@/lib/errors';
import { bookingFlowRepository, disputesRepository, type BookingDetail, type CancellationQuote, type DisputeDetail, type SessionContext } from '@/repositories';

jest.mock('@/repositories', () => ({
  trustRepository: { prompts: jest.fn(async () => ({ ok: true, data: [] })), bookingReviews: jest.fn(async () => ({ ok: true, data: { canReview: false, reviewUntil: null, mine: null, theirs: null } })) },
  bookingFlowRepository: {
    detail: jest.fn(), previewCancellation: jest.fn(), cancel: jest.fn(), reportReturnProblem: jest.fn(), reportNotReturned: jest.fn(), openDispute: jest.fn(),
    confirmCleanReturn: jest.fn(), inbox: jest.fn(async () => ({ ok: true, data: [] })), extensionInbox: jest.fn(async () => ({ ok: true, data: [] })), sweep: jest.fn(),
  },
  disputesRepository: { get: jest.fn(), list: jest.fn(), respond: jest.fn(), resolve: jest.fn(), appeal: jest.fn(), decideAppeal: jest.fn() },
  signedEvidenceUrls: jest.fn(async (paths: string[]) => ({ ok: true, data: Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}`])) })),
  notificationInboxRepository: { unreadCount: jest.fn(async () => ({ ok: true, data: 0 })) },
  profilesRepository: { updateMine: jest.fn() },
  countPendingVerifications: jest.fn(async () => 0),
}));

const APP_DIR = path.resolve(__dirname, '../../app');
const repo = jest.mocked(bookingFlowRepository);
const disputes = jest.mocked(disputesRepository);
const TODAY = todayInBusinessTz();
const NOW = new Date().toISOString();
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

function signIn(userId: string, roles: SessionContext['roles'] = ['borrower', 'lender']) {
  const state: SessionState = { kind: 'signed_in', roles, verification: 'verified', accountStatus: 'active', termsAccepted: true, activeRole: roles.includes('admin') ? null : 'borrower' };
  __setSessionForTests(state, { context: { userId, fullName: 'Bea Santos', accountStatus: 'active', statusReason: null, activeRolePref: null, roles, verificationStatus: 'verified', pendingTerms: [] } });
}

const detail = (o: Partial<BookingDetail> = {}): BookingDetail => ({
  id: 'b1', myRole: 'borrower', status: 'confirmed', listingId: 'l1', listingStatus: 'active',
  pickupDate: addDays(TODAY, 1), returnDate: addDays(TODAY, 2), rentalDays: 2, dueAt: inHours(60), pickupArrangement: null,
  snapshot: { listingTitle: 'Casio fx-991EX scientific calculator', categoryLabel: 'Calculators', condition: 'like_new', pickupPoint: 'Library entrance', pickupNotes: null, coverPath: null, returnDueTimeLocal: '23:59', policyLabel: null, policyIsSample: true },
  dailyRate: 4000, subtotal: 8000, deposit: 30000, total: 38000, lateFeePerDay: 2000, commissionBps: 1000, commission: 800, lenderNet: 7200,
  holdExpiresAt: null, serverNow: NOW, fetchedAtMs: Date.now(), decisionReason: null, cancelReason: null, createdAt: NOW, conflict: null,
  counterpart: { id: 'u2', role: 'lender', fullName: 'Leo Reyes', isStudentVerified: true, ratingAvg: 4.5, ratingCount: 2 },
  terms: null, events: [], payments: [], activatedAt: null, returnedAt: null, completedAt: null, handoverOpensOn: TODAY, lateDaysNow: 0, conversationId: 'c1',
  handover: null, returnInfo: null, extensions: [], refunds: [], lateFeeNow: 0, dispute: null,
  ...o,
});
const asLender = (o: Partial<BookingDetail> = {}) =>
  detail({ myRole: 'lender', counterpart: { id: 'u1', role: 'borrower', fullName: 'Bea Santos', isStudentVerified: true, ratingAvg: null, ratingCount: 0 }, ...o });
const quote = (o: Partial<CancellationQuote> = {}): CancellationQuote => ({
  allowed: true, reason: null, rule: 'borrower_cancel_before_pickup', policyLabel: 'Sample cancellation policy v1', policyIsSample: true, paid: 38000, rentPaid: 8000, depositPaid: 30000,
  rentRefundPct: 50, depositRefundPct: 100, rentRefund: 4000, depositRefund: 30000, refundTotal: 34000, rentKept: 4000, lenderNetAfter: 3600,
  explanation: 'Under the sample policy, cancelling about 10 h before the pickup day refunds 50% of the rent and 100% of the deposit.', ...o,
});
const dispute = (o: Partial<DisputeDetail> = {}): DisputeDetail => ({
  id: 'd1', bookingId: 'b1', myRole: 'borrower', category: 'damage', severity: 'major', status: 'awaiting_borrower_response', description: 'The screen is cracked on return.',
  requestedAmount: 5000, decision: null, resolutionAmount: null, decidedAt: null, createdAt: NOW, openedBy: 'lender', appealDeadline: null, canAppeal: false,
  booking: { status: 'disputed', listingTitle: 'Casio fx-991EX scientific calculator', pickupDate: TODAY, returnDate: addDays(TODAY, 1), dueAt: NOW, subtotal: 8000, deposit: 30000, lateFeePerDay: 2000, lateDays: 0, lateFee: 0, paid: 38000, returnOutcome: 'damaged' },
  borrower: { id: 'u1', fullName: 'Bea Santos' }, lender: { id: 'u2', fullName: 'Leo Reyes' },
  messages: [], evidence: [{ path: 'b1/u2/crack.jpg', note: null, byRole: 'lender' }], ...o,
});

beforeEach(() => jest.clearAllMocks());
afterAll(() => __setSessionForTests(null));

describe('cancellation with a refund preview', () => {
  it('the borrower sees the policy refund and confirms exactly that amount', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(detail()));
    repo.previewCancellation.mockResolvedValue(ok(quote()));
    repo.cancel.mockResolvedValue(ok(quote()));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    await user.press(await screen.findByTestId('open-cancel'));
    expect(await screen.findByTestId('cancel-preview')).toBeOnTheScreen();
    expect(screen.getByText('Rent back to you (50%)')).toBeOnTheScreen();
    expect(screen.getByText('₱340.00')).toBeOnTheScreen();
    expect(screen.getByText('Sample policy')).toBeOnTheScreen();
    expect(screen.getByText(/The lender keeps ₱36 of the rent/)).toBeOnTheScreen();
    await user.press(screen.getByTestId('confirm-cancel'));
    expect(repo.cancel).toHaveBeenCalledWith('b1', '', 34000);
  });
  it('re-previews when the policy window moved before confirming', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(detail()));
    repo.previewCancellation.mockResolvedValueOnce(ok(quote({ rentRefundPct: 100, rentRefund: 8000, refundTotal: 38000, rentKept: 0 }))).mockResolvedValue(ok(quote()));
    repo.cancel.mockResolvedValue(fail(new AppError('conflict', 'The refund amount changed. Review the new amounts and confirm again.', 'refund_changed')));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    await user.press(await screen.findByTestId('open-cancel'));
    expect(within(await screen.findByTestId('cancel-preview')).getByText('₱380.00')).toBeOnTheScreen();
    await user.press(screen.getByTestId('confirm-cancel'));
    expect(await screen.findByText(/The refund amount changed/)).toBeOnTheScreen();
    expect(await screen.findByText('₱340.00')).toBeOnTheScreen();
    expect(repo.previewCancellation).toHaveBeenCalledTimes(2);
  });
  it('a lender must give the borrower a reason', async () => {
    signIn('u2', ['lender']);
    repo.detail.mockResolvedValue(ok(asLender()));
    repo.previewCancellation.mockResolvedValue(ok(quote({ rule: 'lender_cancel_before_pickup', rentRefundPct: 100, rentRefund: 8000, refundTotal: 38000, rentKept: 0 })));
    repo.cancel.mockResolvedValue(ok(quote()));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    await user.press(await screen.findByTestId('open-cancel'));
    await user.press(await screen.findByTestId('confirm-cancel'));
    expect(await screen.findByText('Tell Bea why you’re cancelling.')).toBeOnTheScreen();
    expect(repo.cancel).not.toHaveBeenCalled();
    await user.type(screen.getByTestId('cancel-reason'), 'The calculator broke.');
    await user.press(screen.getByTestId('confirm-cancel'));
    expect(repo.cancel).toHaveBeenCalledWith('b1', 'The calculator broke.', 38000);
  });
  it('after pickup there is no cancel option', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(detail({ status: 'active' })));
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByTestId('rental-panel')).toBeOnTheScreen();
    expect(screen.queryByTestId('open-cancel')).not.toBeOnTheScreen();
  });
});

describe('problem reports open a moderated case', () => {
  it('the lender reports damage at inspection with a claim within the deposit', async () => {
    signIn('u2', ['lender']);
    repo.detail.mockResolvedValue(ok(asLender({ status: 'return_requested', returnInfo: { requestedAt: NOW, borrowerNotes: null, borrowerPhotoPaths: [], inspectedAt: null, outcome: null, lenderNotes: null, lenderPhotoPaths: [], lateDays: 0, lateFee: 0 } })));
    repo.reportReturnProblem.mockResolvedValue(ok('d1'));
    disputes.get.mockResolvedValue(ok(dispute({ myRole: 'lender' })));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    await user.press(await screen.findByTestId('report-return-problem'));
    await user.type(await screen.findByTestId('problem-sheet-notes'), 'Cracked screen on return.');
    await user.type(screen.getByTestId('problem-amount'), '400');
    await user.press(screen.getByTestId('problem-sheet-submit'));
    expect(await screen.findByText('That’s more than TigRent holds for this booking.')).toBeOnTheScreen();
    await user.clear(screen.getByTestId('problem-amount'));
    await user.type(screen.getByTestId('problem-amount'), '50');
    await user.press(screen.getByTestId('problem-sheet-submit'));
    expect(repo.reportReturnProblem).toHaveBeenCalledWith('b1', 'damaged', 'Cracked screen on return.', 5000, []);
    await waitFor(() => expect(screen).toHavePathname('/dispute/d1'));
  });
  it('an overdue item can be escalated by the lender (never automatic)', async () => {
    signIn('u2', ['lender']);
    repo.detail.mockResolvedValue(ok(asLender({ status: 'overdue', lateDaysNow: 3, lateFeeNow: 6000 })));
    repo.reportNotReturned.mockResolvedValue(ok('d2'));
    disputes.get.mockResolvedValue(ok(dispute({ id: 'd2', myRole: 'lender', category: 'missing_item' })));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByText(/₱60 so far/)).toBeOnTheScreen();
    await user.press(screen.getByTestId('report-not-returned'));
    await user.type(await screen.findByTestId('problem-sheet-notes'), 'Not back after three days.');
    await user.press(screen.getByTestId('problem-sheet-submit'));
    expect(repo.reportNotReturned).toHaveBeenCalledWith('b1', 'Not back after three days.', 0);
  });
  it('a disputed booking links to its case', async () => {
    signIn('u1');
    repo.detail.mockResolvedValue(ok(detail({ status: 'disputed', dispute: { id: 'd1', status: 'under_review', category: 'damage' } })));
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByTestId('dispute-banner')).toBeOnTheScreen();
    expect(screen.getByText('Moderator reviewing')).toBeOnTheScreen();
  });
});

describe('the dispute case', () => {
  it('the borrower is asked to reply, adds their side, and sees private evidence', async () => {
    signIn('u1');
    disputes.get.mockResolvedValue(ok(dispute()));
    disputes.respond.mockResolvedValue(ok(true));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/dispute/d1' });
    expect(await screen.findByText('Your reply is needed')).toBeOnTheScreen();
    expect(await screen.findByLabelText('From the lender')).toBeOnTheScreen();
    await user.press(screen.getByTestId('dispute-reply'));
    await user.type(await screen.findByTestId('dispute-reply-sheet-notes'), 'It was scratched at pickup.');
    await user.press(screen.getByTestId('dispute-reply-sheet-submit'));
    expect(disputes.respond).toHaveBeenCalledWith('d1', 'It was scratched at pickup.', [], null);
  });
  it('a decided case can be appealed once', async () => {
    signIn('u1');
    disputes.get.mockResolvedValue(ok(dispute({ status: 'resolved_compensation', decision: 'Photos show new damage.', resolutionAmount: 3000, decidedAt: NOW, canAppeal: true, appealDeadline: inHours(24 * 7) })));
    disputes.appeal.mockResolvedValue(ok(true));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/dispute/d1' });
    expect(await screen.findByTestId('dispute-decision')).toBeOnTheScreen();
    expect(screen.queryByTestId('dispute-reply')).not.toBeOnTheScreen();
    await user.press(screen.getByTestId('appeal'));
    await user.type(await screen.findByTestId('appeal-reason'), 'The scratch was there before.');
    await user.press(screen.getByTestId('confirm-appeal'));
    expect(disputes.appeal).toHaveBeenCalledWith('d1', 'The scratch was there before.');
  });
  it('a moderator decides with a clear who-gets-what preview', async () => {
    signIn('a1', ['admin', 'moderator']);
    disputes.get.mockResolvedValue(ok(dispute({ myRole: 'staff', status: 'under_review' })));
    disputes.resolve.mockResolvedValue(ok({ status: 'resolved_compensation', repeated: false }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/dispute/d1' });
    expect(await screen.findByTestId('resolve-panel')).toBeOnTheScreen();
    expect(screen.getByTestId('resolve')).toBeDisabled();
    await user.type(screen.getByTestId('resolve-deposit'), '30');
    await user.type(screen.getByTestId('resolve-decision'), 'Photos show new damage to the screen.');
    expect(screen.getByText('Borrower gets ₱270 back; lender gets ₱30 from the deposit (simulated).')).toBeOnTheScreen();
    await user.press(screen.getByTestId('resolve'));
    await user.press(await screen.findByTestId('resolve-dialog-confirm'));
    expect(disputes.resolve).toHaveBeenCalledWith('d1', 3000, 0, 'completed', 'Photos show new damage to the screen.');
  });
  it('the moderator queue opens each case', async () => {
    signIn('a1', ['admin', 'moderator']);
    disputes.list.mockResolvedValue(ok([{ id: 'd1', bookingId: 'b1', listingTitle: 'Casio fx-991EX', category: 'damage', severity: 'major', status: 'under_review', requestedAmount: 5000, borrowerName: 'Bea Santos', lenderName: 'Leo Reyes', createdAt: NOW }]));
    disputes.get.mockResolvedValue(ok(dispute({ myRole: 'staff', status: 'under_review' })));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/admin/disputes' });
    await user.press(await screen.findByTestId('dispute-d1'));
    expect(screen).toHavePathname('/dispute/d1');
  });
});
