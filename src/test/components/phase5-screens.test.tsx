import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, screen } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import type { AppNotification, BookingSummary, ProfileSummary } from '@/domain/entities';
import type { SessionState } from '@/features/auth/route-resolver';
import { __setSessionForTests } from '@/features/auth/session';
import { addDays, todayInBusinessTz } from '@/lib/dates';
import { ok } from '@/lib/errors';
import {
  bookingsRepository,
  discoverRepository,
  ledgerRepository,
  listingsRepository,
  notificationInboxRepository,
  notificationsRepository,
  profileSummaryRepository,
  sessionRepository,
  type SessionContext,
} from '@/repositories';

jest.mock('@/repositories', () => ({
  trustRepository: { prompts: jest.fn(async () => ({ ok: true, data: [] })), bookingReviews: jest.fn(async () => ({ ok: true, data: { canReview: false, reviewUntil: null, mine: null, theirs: null } })) },
  bookingsRepository: { listMine: jest.fn() },
  bookingFlowRepository: { detail: jest.fn(async () => ({ ok: false, error: { kind: 'not_found', message: 'This booking isn’t yours or no longer exists.' } })) },
  discoverRepository: { featured: jest.fn() },
  discoveryRepository: { categories: jest.fn(async () => ({ ok: true, data: [] })) },
  listingsRepository: { listByLender: jest.fn() },
  ledgerRepository: { myPayables: jest.fn() },
  notificationsRepository: { listMine: jest.fn(), markRead: jest.fn(async () => ({ ok: true, data: {} })) },
  notificationInboxRepository: { unreadCount: jest.fn(), markAllRead: jest.fn() },
  profileSummaryRepository: { get: jest.fn() },
  sessionRepository: { enableRole: jest.fn() },
  profilesRepository: { updateMine: jest.fn() },
  termsRepository: { listActive: jest.fn(async () => ({ ok: true, data: [] })) },
  verificationRepository: { listMine: jest.fn(async () => ({ ok: true, data: [] })) },
}));

const APP_DIR = path.resolve(__dirname, '../../app');
const TODAY = todayInBusinessTz();
const bookings = jest.mocked(bookingsRepository);
const inbox = jest.mocked(notificationInboxRepository);
const notifications = jest.mocked(notificationsRepository);
const summaryRepo = jest.mocked(profileSummaryRepository);
const session = jest.mocked(sessionRepository);

let n = 0;
const booking = (o: Partial<BookingSummary>): BookingSummary => ({
  id: `b${++n}`, listingId: 'l1', borrowerId: 'u1', lenderId: 'u2', listingTitle: 'Item', pickupDate: TODAY, returnDate: TODAY,
  rentalDays: 1, dueAt: '2026-01-01T00:00:00Z', status: 'confirmed', total: 33000, deposit: 30000, subtotal: 3000, lenderNet: 2700, holdExpiresAt: null, ...o,
});
const summary = (o: Partial<ProfileSummary> = {}): ProfileSummary => ({
  userId: 'u1', fullName: 'Mika Uy', avatarPath: null, memberSince: '2026-08-01T00:00:00Z', isStudentVerified: true, completedLendings: 5, completedBorrowings: 0,
  lenderRating: { avg: 4.8, count: 5 }, borrowerRating: { avg: null, count: 0 },
  badges: [{ code: 'student_verified', label: 'Student verified' }, { code: 'trusted_lender', label: 'Verified Trusted Lender' }],
  trustedLender: {
    earned: true, ruleIsSample: true, rule: { minCompletedLendings: 5, minAvgRating: 4.5, noUnresolvedSevereDisputes: true },
    progress: { studentVerified: true, accountInGoodStanding: true, completedLendings: 5, avgRating: 4.8, unresolvedSevereDisputes: 0 },
  },
  ...o,
});

function signIn(roles: SessionContext['roles'], extra = {}, accountStatus: SessionContext['accountStatus'] = 'active') {
  const state: SessionState = { kind: 'signed_in', roles, verification: 'verified', accountStatus, termsAccepted: true, activeRole: null };
  const context: SessionContext = { userId: 'u1', fullName: 'Bea Santos', accountStatus, statusReason: null, activeRolePref: null, roles, verificationStatus: 'verified', pendingTerms: [] };
  __setSessionForTests(state, { context, ...extra });
}

beforeEach(() => {
  jest.clearAllMocks();
  inbox.unreadCount.mockResolvedValue(ok(2));
  jest.mocked(discoverRepository.featured).mockResolvedValue(
    ok([
      { id: 'l9', lenderId: 'u2', title: 'TI-84 Plus graphing calculator', category: 'calculators', condition: 'good', dailyRate: 8000, deposit: 100000, lateFeePerDay: 4000, status: 'active', isFeatured: true, coverPath: null },
      { id: 'l10', lenderId: 'u3', title: 'Unfeatured camera', category: 'photo-video', condition: 'like_new', dailyRate: 9000, deposit: 100000, lateFeePerDay: 4000, status: 'active', isFeatured: false, coverPath: null },
    ]),
  );
  jest.mocked(listingsRepository.listByLender).mockResolvedValue(ok([]));
  jest.mocked(ledgerRepository.myPayables).mockResolvedValue(ok([8100, 3600]));
  summaryRepo.get.mockResolvedValue(ok(summary()));
});
afterAll(() => __setSessionForTests(null));

describe('borrower home', () => {
  it('shows the next return, real counts, featured items and an unread badge', async () => {
    signIn(['borrower']);
    bookings.listMine.mockResolvedValue(ok([
      booking({ status: 'active', returnDate: addDays(TODAY, 1), listingTitle: 'Portable projector' }),
      booking({ status: 'confirmed', pickupDate: addDays(TODAY, 3), listingTitle: 'Canon EOS 200D' }),
      booking({ status: 'pending_lender_approval', pickupDate: addDays(TODAY, 7) }),
    ]));
    await renderRouter(APP_DIR, { initialUrl: '/borrower' });
    expect(await screen.findByText(/Hi, Bea/)).toBeOnTheScreen();
    expect(screen.getByText(/Portable projector/)).toBeOnTheScreen();
    expect(screen.getByText(/Due tomorrow/)).toBeOnTheScreen();
    expect(screen.getByText('Upcoming')).toBeOnTheScreen();
    expect(screen.getByText('TI-84 Plus graphing calculator')).toBeOnTheScreen();
    expect(screen.getByTestId('spotlight-l9')).toBeOnTheScreen();
    expect(screen.getByLabelText('TI-84 Plus graphing calculator, ₱80 per day, Good')).toBeOnTheScreen();
    expect(screen.queryByText('Unfeatured camera')).not.toBeOnTheScreen();
    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeOnTheScreen();
  });
});

describe('lender dashboard', () => {
  it('counts requests, shows simulated earnings and a truthful Tiggy hint', async () => {
    signIn(['lender']);
    bookings.listMine.mockResolvedValue(ok([
      booking({ status: 'pending_lender_approval', lenderId: 'u1', borrowerId: 'u3' }),
      booking({ status: 'pending_lender_approval', lenderId: 'u1', borrowerId: 'u4' }),
      booking({ status: 'overdue', lenderId: 'u1', borrowerId: 'u5', returnDate: addDays(TODAY, -2), listingTitle: 'Travel tripod' }),
    ]));
    await renderRouter(APP_DIR, { initialUrl: '/lender' });
    expect(await screen.findByLabelText('2 New requests')).toBeOnTheScreen();
    expect(screen.getByText('2 days overdue')).toBeOnTheScreen();
    expect(screen.getByText('₱117.00')).toBeOnTheScreen();
    expect(screen.getAllByText('Simulated').length).toBeGreaterThan(0);
    expect(screen.getByText('List your first item')).toBeOnTheScreen();
    expect(screen.getByLabelText('Tiggy, the TigRent mascot. Tap for a tip.')).toBeOnTheScreen();
  });
});

describe('profile', () => {
  it('shows badges with explained criteria and split ratings', async () => {
    signIn(['lender']);
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/lender/profile' });
    expect(await screen.findByText('Verified Trusted Lender')).toBeOnTheScreen();
    expect(screen.getByLabelText('★ 4.8 As lender (5)')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'About badges' }));
    expect(screen.getByText(/not an official UST endorsement/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Met: At least 5 completed lendings (you have 5)')).toBeOnTheScreen();
    expect(screen.getByText('Sample criteria')).toBeOnTheScreen();
  });

  it('lets a lender-only student enable borrowing on the same account', async () => {
    const applyContext = jest.fn();
    signIn(['lender'], { applyContext });
    session.enableRole.mockResolvedValue(ok({ userId: 'u1', fullName: 'Bea', accountStatus: 'active', statusReason: null, activeRolePref: null, roles: ['borrower', 'lender'], verificationStatus: 'verified', pendingTerms: [] }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/lender/profile' });
    await user.press(await screen.findByTestId('enable-role'));
    await user.press(screen.getByTestId('enable-role-dialog-confirm'));
    expect(session.enableRole).toHaveBeenCalledWith('borrower');
    expect(applyContext).toHaveBeenCalledWith(expect.objectContaining({ roles: ['borrower', 'lender'] }));
  });

  it('explains why a restricted student cannot enable a new role', async () => {
    signIn(['borrower'], {}, 'paused_pending_review');
    await renderRouter(APP_DIR, { initialUrl: '/borrower/profile' });
    expect(await screen.findByTestId('enable-role')).toBeDisabled();
    expect(screen.getByText('New roles can’t be enabled while your account is under review.')).toBeOnTheScreen();
  });
});

describe('notification inbox', () => {
  const note = (o: Partial<AppNotification>): AppNotification => ({
    id: `n${++n}`, type: 'verification.approved', title: 'You’re verified', body: 'Approved.', entityType: 'verification', entityId: 'v1', readAt: null, createdAt: '2026-11-18T02:00:00Z', ...o,
  });

  it('marks all as read', async () => {
    signIn(['borrower']);
    notifications.listMine.mockResolvedValue(ok([note({}), note({ readAt: '2026-11-18T03:00:00Z', title: 'Old' })]));
    inbox.markAllRead.mockResolvedValue(ok(1));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/notifications' });
    await user.press(await screen.findByTestId('mark-all-read'));
    expect(inbox.markAllRead).toHaveBeenCalled();
  });

  it('deep-links a verification notification to the status screen and marks it read', async () => {
    signIn(['borrower']);
    const n1 = note({});
    notifications.listMine.mockResolvedValue(ok([n1]));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/notifications' });
    await user.press(await screen.findByTestId(`notification-${n1.id}`));
    expect(notifications.markRead).toHaveBeenCalledWith(n1.id);
    expect(screen).toHavePathname('/onboarding/status');
  });

  it('opens the booking itself from a booking notification', async () => {
    signIn(['borrower', 'lender']);
    const n1 = note({ type: 'booking.requested', entityType: 'booking', entityId: 'b1', title: 'New booking request' });
    notifications.listMine.mockResolvedValue(ok([n1]));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/notifications' });
    await user.press(await screen.findByTestId(`notification-${n1.id}`));
    expect(screen).toHavePathname('/booking/b1');
  });

  it('empty inbox offers a working way back', async () => {
    signIn(['borrower']);
    notifications.listMine.mockResolvedValue(ok([]));
    bookings.listMine.mockResolvedValue(ok([]));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/notifications' });
    await user.press(await screen.findByRole('button', { name: 'Go home' }));
    expect(screen).toHavePathname('/borrower');
  });
});

describe('my rentals', () => {
  it('groups rentals by state with counts', async () => {
    signIn(['borrower']);
    bookings.listMine.mockResolvedValue(ok([
      booking({ status: 'completed', listingTitle: 'Ring light' }),
      booking({ status: 'active', listingTitle: 'Projector' }),
      booking({ status: 'cancelled', listingTitle: 'DSLR' }),
    ]));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/borrower/rentals' });
    expect(await screen.findByText('Projector')).toBeOnTheScreen();
    await user.press(screen.getByTestId('rentals-filter-completed'));
    expect(screen.getByText('Ring light')).toBeOnTheScreen();
    expect(screen.queryByText('Projector')).not.toBeOnTheScreen();
  });
});

describe('settings', () => {
  it('persists the reduce-motion preference on this device', async () => {
    signIn(['borrower']);
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/settings' });
    const sw = await screen.findByTestId('reduce-motion-switch');
    // Switch toggles via onValueChange; fire it directly to avoid platform-specific press handling.
    const { fireEvent } = await import('@testing-library/react-native');
    await fireEvent(sw, 'valueChange', true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('tigrent.reduceMotion', 'true');
    await user.press(screen.getByTestId('help-payments'));
    expect(screen.getByText(/Checkout, refunds and lender payouts in this prototype are simulated/)).toBeOnTheScreen();
  });
});
