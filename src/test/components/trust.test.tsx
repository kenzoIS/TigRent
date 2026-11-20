import path from 'path';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import type { SessionState } from '@/features/auth/route-resolver';
import { __setSessionForTests } from '@/features/auth/session';
import { addDays, todayInBusinessTz } from '@/lib/dates';
import { ok } from '@/lib/errors';
import { bookingFlowRepository, trustRepository, type AccountHealth, type BookingDetail, type SessionContext } from '@/repositories';

jest.mock('@/repositories', () => ({
  bookingFlowRepository: { detail: jest.fn(), sweep: jest.fn() },
  bookingsRepository: { listMine: jest.fn(async () => ({ ok: true, data: [] })) },
  trustRepository: {
    submitReview: jest.fn(), bookingReviews: jest.fn(), prompts: jest.fn(async () => ({ ok: true, data: [] })), listReviews: jest.fn(async () => ({ ok: true, data: [] })),
    reportReview: jest.fn(), myAccountHealth: jest.fn(), submitAppeal: jest.fn(), accountQueue: jest.fn(), accountReview: jest.fn(), moderateAccount: jest.fn(),
    reportedReviews: jest.fn(), moderateReview: jest.fn(),
  },
  signedEvidenceUrls: jest.fn(async () => ({ ok: true, data: {} })),
  notificationInboxRepository: { unreadCount: jest.fn(async () => ({ ok: true, data: 0 })) },
  profilesRepository: { updateMine: jest.fn() },
  countPendingVerifications: jest.fn(async () => 0),
}));

const APP_DIR = path.resolve(__dirname, '../../app');
const repo = jest.mocked(bookingFlowRepository);
const trust = jest.mocked(trustRepository);
const TODAY = todayInBusinessTz();
const NOW = new Date().toISOString();

function signIn(userId: string, roles: SessionContext['roles'], accountStatus: SessionContext['accountStatus'] = 'active', statusReason: string | null = null) {
  const state: SessionState = { kind: 'signed_in', roles, verification: 'verified', accountStatus, termsAccepted: true, activeRole: null };
  __setSessionForTests(state, { context: { userId, fullName: 'Bea Santos', accountStatus, statusReason, activeRolePref: null, roles, verificationStatus: 'verified', pendingTerms: [] } });
}

const completed = (o: Partial<BookingDetail> = {}): BookingDetail => ({
  id: 'b1', myRole: 'borrower', status: 'completed', listingId: 'l1', listingStatus: 'active', pickupDate: addDays(TODAY, -2), returnDate: addDays(TODAY, -1), rentalDays: 2, dueAt: NOW, pickupArrangement: null,
  snapshot: { listingTitle: 'Casio fx-991EX scientific calculator', categoryLabel: null, condition: null, pickupPoint: null, pickupNotes: null, coverPath: null, returnDueTimeLocal: '23:59', policyLabel: null, policyIsSample: true },
  dailyRate: 4000, subtotal: 8000, deposit: 30000, total: 38000, lateFeePerDay: 2000, commissionBps: 1000, commission: 800, lenderNet: 7200, holdExpiresAt: null, serverNow: NOW, fetchedAtMs: Date.now(),
  decisionReason: null, cancelReason: null, createdAt: NOW, conflict: null, counterpart: { id: 'u2', role: 'lender', fullName: 'Leo Reyes', isStudentVerified: true, ratingAvg: 4.5, ratingCount: 2 },
  terms: null, events: [], payments: [], activatedAt: NOW, returnedAt: NOW, completedAt: NOW, handoverOpensOn: TODAY, lateDaysNow: 0, conversationId: 'c1', handover: null,
  returnInfo: { requestedAt: NOW, borrowerNotes: null, borrowerPhotoPaths: [], inspectedAt: NOW, outcome: 'clean', lenderNotes: null, lenderPhotoPaths: [], lateDays: 0, lateFee: 0 },
  extensions: [], refunds: [], lateFeeNow: 0, dispute: null, ...o,
});
const health = (o: Partial<AccountHealth> = {}): AccountHealth => ({
  accountStatus: 'paused_pending_review', statusReason: 'Automatic review: 3 ratings averaging 1.67 (sample rule).',
  metrics: { reviewCount: 3, avgRating: 1.67, rule: { minReviews: 3, avgBelow: 2.5, action: 'paused_pending_review' }, ruleIsSample: true, ruleMet: true },
  appeal: null, history: [{ from: 'active', to: 'paused_pending_review', reason: 'Automatic review', automatic: true, at: NOW }], openObligations: 1, ...o,
});

beforeEach(() => jest.clearAllMocks());
afterAll(() => __setSessionForTests(null));

describe('reviews after completion', () => {
  it('rates the other party once with stars and an optional comment', async () => {
    signIn('u1', ['borrower']);
    repo.detail.mockResolvedValue(ok(completed()));
    trust.bookingReviews.mockResolvedValueOnce(ok({ canReview: true, reviewUntil: NOW, mine: null, theirs: null }))
      .mockResolvedValue(ok({ canReview: false, reviewUntil: NOW, mine: { id: 'r1', rating: 4, comment: 'Great', createdAt: NOW, moderationStatus: 'visible' }, theirs: null }));
    trust.submitReview.mockResolvedValue(ok('r1'));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByText('Rate Leo as a lender')).toBeOnTheScreen();
    await user.press(screen.getByTestId('submit-review'));
    expect(await screen.findByText('Choose 1 to 5 stars.')).toBeOnTheScreen();
    await user.press(screen.getByTestId('rate-4'));
    await user.type(screen.getByTestId('review-comment'), 'Great');
    await user.press(screen.getByTestId('submit-review'));
    expect(trust.submitReview).toHaveBeenCalledWith('b1', 4, 'Great');
    expect(await screen.findByText('Your review of Leo')).toBeOnTheScreen();
  });
  it('shows their review of me and lets me report it to moderators', async () => {
    signIn('u1', ['borrower']);
    repo.detail.mockResolvedValue(ok(completed()));
    trust.bookingReviews.mockResolvedValue(ok({ canReview: false, reviewUntil: NOW, mine: { id: 'r1', rating: 5, comment: null, createdAt: NOW, moderationStatus: 'visible' }, theirs: { id: 'r2', rating: 1, comment: 'Rude', createdAt: NOW, moderationStatus: 'visible', isReported: false } }));
    trust.reportReview.mockResolvedValue(ok(true));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/booking/b1' });
    expect(await screen.findByTestId('their-review')).toBeOnTheScreen();
    await user.press(screen.getByTestId('report-their-review'));
    await user.press(await screen.findByText('Inaccurate'));
    await user.press(screen.getByTestId('confirm-report-review'));
    expect(trust.reportReview).toHaveBeenCalledWith('r2', 'Inaccurate');
  });
  it('prompts appear on My Rentals and open the booking', async () => {
    signIn('u1', ['borrower']);
    trust.prompts.mockResolvedValue(ok([{ bookingId: 'b1', listingTitle: 'Casio', counterpartName: 'Leo Reyes', myRole: 'borrower', completedAt: NOW, reviewUntil: NOW }]));
    repo.detail.mockResolvedValue(ok(completed()));
    trust.bookingReviews.mockResolvedValue(ok({ canReview: true, reviewUntil: NOW, mine: null, theirs: null }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/borrower/rentals' });
    await user.press(await screen.findByTestId('review-prompt-b1'));
    expect(screen).toHavePathname('/booking/b1');
  });
});

describe('restricted account', () => {
  it('explains the sample rule, keeps rentals reachable and sends an appeal', async () => {
    signIn('u7', ['borrower', 'lender'], 'paused_pending_review', 'Automatic review');
    trust.myAccountHealth.mockResolvedValueOnce(ok(health())).mockResolvedValue(ok(health({ appeal: { id: 'a1', status: 'open', reason: 'x', moderatorNote: null, createdAt: NOW, decidedAt: null } })));
    trust.submitAppeal.mockResolvedValue(ok('a1'));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/restricted' });
    expect(await screen.findByTestId('account-health')).toBeOnTheScreen();
    expect(screen.getByText(/Sample rule: an account is paused/)).toBeOnTheScreen();
    expect(screen.getByText(/\(1 open rental\)/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /My existing rentals/ })).toBeOnTheScreen();
    await user.press(screen.getByTestId('open-appeal'));
    await user.type(await screen.findByTestId('appeal-text'), 'My lab schedule changed twice.');
    await user.press(screen.getByTestId('submit-appeal'));
    expect(trust.submitAppeal).toHaveBeenCalledWith('My lab schedule changed twice.');
    expect(await screen.findByText('Appeal with a moderator')).toBeOnTheScreen();
    expect(screen.queryByTestId('open-appeal')).not.toBeOnTheScreen();
  });
  it('a moderator’s request for information is shown with a reply action', async () => {
    signIn('u7', ['borrower'], 'paused_pending_review');
    trust.myAccountHealth.mockResolvedValue(ok(health({ appeal: { id: 'a1', status: 'needs_info', reason: 'x', moderatorNote: 'Send the schedule notice.', createdAt: NOW, decidedAt: null } })));
    await renderRouter(APP_DIR, { initialUrl: '/restricted' });
    expect(await screen.findByText('Moderator: “Send the schedule notice.”')).toBeOnTheScreen();
    expect(screen.getByText('Send the requested information')).toBeOnTheScreen();
  });
});

describe('moderation', () => {
  const review = { userId: 'u7', fullName: 'Rico Garcia', memberSince: NOW, reviews: [{ id: 'r9', rating: 1, comment: 'Bad', direction: 'lender_to_borrower' as const, createdAt: NOW, moderationStatus: 'visible', isReported: true, reportReason: 'Inaccurate' }], ...health({ appeal: { id: 'a1', status: 'open', reason: 'Please review.', moderatorNote: null, createdAt: NOW, decidedAt: null } }) };
  it('the queue opens an account; a moderator records a reasoned decision (suspension is admin-only)', async () => {
    signIn('m1', ['moderator']);
    trust.accountQueue.mockResolvedValue(ok([{ userId: 'u7', fullName: 'Rico Garcia', accountStatus: 'paused_pending_review', statusReason: 'Automatic', reviewCount: 3, avgRating: 1.67, ruleMet: true, appealStatus: 'open', openObligations: 1 }]));
    trust.accountReview.mockResolvedValue(ok(review));
    trust.moderateAccount.mockResolvedValue(ok({ accountStatus: 'active', appealStatus: 'lifted' }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/admin/accounts' });
    await user.press(await screen.findByTestId('account-u7'));
    expect(screen).toHavePathname('/admin/accounts/u7');
    expect(await screen.findByTestId('account-appeal')).toBeOnTheScreen();
    expect(screen.queryByText('Suspend')).not.toBeOnTheScreen();
    expect(screen.getByText('Suspension is for administrators.')).toBeOnTheScreen();
    expect(screen.getByTestId('account-decide')).toBeDisabled();
    await user.type(screen.getByTestId('account-note'), 'Late returns explained by a schedule change.');
    await user.press(screen.getByTestId('account-decide'));
    await user.press(await screen.findByTestId('account-dialog-confirm'));
    expect(trust.moderateAccount).toHaveBeenCalledWith('u7', 'lift', 'Late returns explained by a schedule change.');
  });
  it('reported reviews need a note to keep or hide', async () => {
    signIn('a1', ['admin', 'moderator']);
    trust.reportedReviews.mockResolvedValue(ok([{ id: 'r9', rating: 1, comment: 'Bad', direction: 'lender_to_borrower', reportReason: 'Inaccurate', reportedAt: NOW, reviewerName: 'Mika Uy', targetId: 'u7', targetName: 'Rico Garcia', listingTitle: 'Ring light' }]));
    trust.moderateReview.mockResolvedValue(ok(true));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/admin/reviews' });
    expect(await screen.findByTestId('hide-r9')).toBeDisabled();
    await user.type(screen.getByTestId('note-r9'), 'Off-topic');
    await user.press(screen.getByTestId('hide-r9'));
    await waitFor(() => expect(trust.moderateReview).toHaveBeenCalledWith('r9', 'hide', 'Off-topic'));
  });
});
