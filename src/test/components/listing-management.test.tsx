import path from 'path';
import { renderRouter, screen } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import type { SessionState } from '@/features/auth/route-resolver';
import { __setSessionForTests } from '@/features/auth/session';
import { AppError, fail, ok } from '@/lib/errors';
import { listingManagementRepository, listingModerationRepository, type ListingDetail, type ListingManageRow, type SessionContext } from '@/repositories';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///cover.jpg', mimeType: 'image/jpeg', fileSize: 1000 }] })),
  launchCameraAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///cover.jpg', mimeType: 'image/jpeg', fileSize: 1000 }] })),
}));

jest.mock('@/providers/storage/private-upload', () => ({
  buildObjectPath: jest.fn(() => 'new-id/cover.jpg'),
  uploadPrivateFile: jest.fn(() => ({ promise: Promise.resolve({ ok: true, data: { path: 'new-id/cover.jpg' } }), cancel: jest.fn() })),
}));

jest.mock('@/repositories', () => ({
  listingManagementRepository: {
    listMine: jest.fn(), get: jest.fn(), categories: jest.fn(), pickupPoints: jest.fn(), create: jest.fn(), update: jest.fn(),
    setStatus: jest.fn(), addImage: jest.fn(), removeImage: jest.fn(), reorderImages: jest.fn(), addBlock: jest.fn(), removeBlock: jest.fn(),
  },
  listingModerationRepository: { listOpen: jest.fn(), listHidden: jest.fn(), resolve: jest.fn(), restore: jest.fn() },
  premiumRepository: { mine: jest.fn(async () => ({ ok: true, data: { id: null, status: 'inactive', price: 9900, periodStart: null, periodEnd: null, isActive: false, isSample: true } })), markFeatured: jest.fn(), bulkSetListingStatus: jest.fn() },
  signedListingImageUrls: jest.fn(async () => ({ ok: true, data: {} })),
  settingsRepository: { listCurrent: jest.fn(async () => ({ ok: true, data: [{ key: 'commission_bps', value: 1000, version: 1, isSample: false, description: '' }] })) },
  countPendingVerifications: jest.fn(async () => 0),
  profilesRepository: { updateMine: jest.fn() },
}));

const APP_DIR = path.resolve(__dirname, '../../app');
const repo = jest.mocked(listingManagementRepository);
const moderation = jest.mocked(listingModerationRepository);

function signIn(roles: SessionContext['roles'] = ['lender'], accountStatus: SessionContext['accountStatus'] = 'active') {
  const state: SessionState = { kind: 'signed_in', roles, verification: 'verified', accountStatus, termsAccepted: true, activeRole: null };
  const context: SessionContext = { userId: 'u1', fullName: 'Leo Reyes', accountStatus, statusReason: null, activeRolePref: null, roles, verificationStatus: 'verified', pendingTerms: [] };
  __setSessionForTests(state, { context });
}
const row = (o: Partial<ListingManageRow>): ListingManageRow => ({
  id: 'l1', title: 'Item', category: 'calculators', condition: 'good', dailyRate: 4000, deposit: 30000, status: 'active', moderationStatus: 'ok',
  updatedAt: '2026-11-10T00:00:00Z', coverPath: null, photoCount: 1, ...o,
});
const detail = (o: Partial<ListingDetail> = {}): ListingDetail => ({
  id: 'l1', lenderId: 'u1', title: 'Casio fx-991EX', description: 'Exam-approved', category: 'calculators', categoryLabel: 'Calculators', condition: 'like_new',
  equipmentNotes: null, dailyRate: 4000, deposit: 30000, lateFeePerDay: 2000, pickupPointId: 'p1', pickupPointLabel: 'Library entrance', pickupNotes: null,
  status: 'draft', moderationStatus: 'ok', publishedAt: null, updatedAt: '2026-11-10T00:00:00Z', images: [], blocks: [], held: [], ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  repo.categories.mockResolvedValue(ok([{ value: 'calculators', label: 'Calculators' }]));
  repo.pickupPoints.mockResolvedValue(ok([{ value: 'p1', label: 'Library entrance', description: 'Sample', isSample: true }]));
  repo.addImage.mockResolvedValue(ok('image-id'));
});
afterAll(() => __setSessionForTests(null));

describe('My Equipment', () => {
  it('searches and filters, and opens a listing', async () => {
    signIn();
    repo.listMine.mockResolvedValue(ok([row({ id: 'a', title: 'Tripod' }), row({ id: 'b', title: 'Calculator', status: 'draft' }), row({ id: 'c', title: 'Camera', moderationStatus: 'hidden' })]));
    repo.get.mockResolvedValue(ok(detail()));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/lender/equipment' });
    expect(await screen.findByText('Hidden by moderator')).toBeOnTheScreen();
    await user.press(screen.getByTestId('equipment-filter-draft'));
    expect(screen.getByText('Calculator')).toBeOnTheScreen();
    expect(screen.queryByText('Tripod')).not.toBeOnTheScreen();
    await user.press(screen.getByTestId('equipment-filter-all'));
    await user.type(screen.getByLabelText('Search your equipment'), 'trip');
    expect(screen.queryByText('Camera')).not.toBeOnTheScreen();
    await user.press(screen.getByTestId('equipment-a'));
    expect(screen).toHavePathname('/manage/listings/a');
  });

  it('a restricted lender cannot start a new listing and sees why', async () => {
    signIn(['lender'], 'paused_pending_review');
    repo.listMine.mockResolvedValue(ok([row({})]));
    await renderRouter(APP_DIR, { initialUrl: '/lender/equipment' });
    expect(await screen.findByTestId('equipment-new')).toBeDisabled();
    expect(screen.getByText(/New listings are paused/)).toBeOnTheScreen();
  });
});

describe('create wizard', () => {
  it('validates each step, saves a draft, and opens the overview', async () => {
    signIn();
    repo.create.mockResolvedValue(ok('new-id'));
    repo.get.mockResolvedValue(ok(detail({ id: 'new-id' })));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/manage/listings/new' });
    await user.press(await screen.findByTestId('wizard-next'));
    expect(screen.getByText('Use at least 3 characters.')).toBeOnTheScreen();
    await user.type(screen.getByLabelText('Title'), 'Casio fx-991EX');
    await user.press(screen.getByRole('button', { name: 'Category: not set' }));
    await user.press(await screen.findByRole('button', { name: 'Calculators' }));
    await user.press(screen.getByRole('button', { name: 'Condition: not set' }));
    await user.press(await screen.findByRole('button', { name: /Like new/ }));
    await user.press(screen.getByTestId('listing-photo-library'));
    await user.press(screen.getByTestId('wizard-next'));
    expect(await screen.findByText('Price and deposit')).toBeOnTheScreen();
    expect(screen.getByText(/keeps a 10% commission/)).toBeOnTheScreen();
    await user.type(screen.getByLabelText('Daily rate (₱)'), '40');
    await user.press(screen.getByTestId('wizard-next'));
    await user.press(await screen.findByRole('button', { name: 'Pickup point: not set' }));
    await user.press(await screen.findByRole('button', { name: /Library entrance/ }));
    await user.press(screen.getByTestId('wizard-submit'));
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Casio fx-991EX', daily_rate: 4000, deposit: 0, late_fee_per_day: 0, pickup_point_id: 'p1' }));
    expect(repo.addImage).toHaveBeenCalledWith('new-id', 'new-id/cover.jpg');
    expect(screen).toHavePathname('/manage/listings/new-id');
  });

  it('jumps back to the step of a server-side field error', async () => {
    signIn();
    repo.get.mockResolvedValue(ok(detail({ status: 'active' })));
    repo.update.mockResolvedValue(fail(new AppError('validation', 'An active listing needs a daily rate above ₱0.', 'daily_rate')));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/manage/listings/l1/edit' });
    await user.press(await screen.findByTestId('wizard-next'));
    await user.press(await screen.findByTestId('wizard-next'));
    await user.press(await screen.findByTestId('wizard-submit'));
    expect(await screen.findByText('An active listing needs a daily rate above ₱0.')).toBeOnTheScreen();
    expect(screen.getByText('Price and deposit')).toBeOnTheScreen();
  });
});

describe('listing overview', () => {
  it('blocks publishing until the checklist is complete', async () => {
    signIn();
    repo.get.mockResolvedValue(ok(detail()));
    await renderRouter(APP_DIR, { initialUrl: '/manage/listings/l1' });
    expect(await screen.findByLabelText('To do: At least one photo')).toBeOnTheScreen();
    expect(screen.getByTestId('listing-publish')).toBeDisabled();
  });

  it('publishes after confirmation when ready', async () => {
    signIn();
    repo.get.mockResolvedValue(ok(detail({ images: [{ id: 'i1', path: 'l1/a.jpg', sortOrder: 0 }] })));
    repo.setStatus.mockResolvedValue(ok('active'));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/manage/listings/l1' });
    await user.press(await screen.findByTestId('listing-publish'));
    await user.press(screen.getByTestId('listing-action-confirm'));
    expect(repo.setStatus).toHaveBeenCalledWith('l1', 'active');
  });

  it('shows the server reason when removal is blocked by open bookings', async () => {
    signIn();
    repo.get.mockResolvedValue(ok(detail({ status: 'active', images: [{ id: 'i1', path: 'l1/a.jpg', sortOrder: 0 }] })));
    repo.setStatus.mockResolvedValue(fail(new AppError('conflict', 'This item has 2 open request(s) or rental(s).', 'open_bookings')));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/manage/listings/l1' });
    await user.press(await screen.findByTestId('listing-remove'));
    await user.press(screen.getByTestId('listing-action-confirm'));
    expect(await screen.findByText(/2 open request/)).toBeOnTheScreen();
  });
});

describe('availability', () => {
  it('tapping a free date opens a block sheet and saves the range', async () => {
    signIn();
    repo.get.mockResolvedValue(ok(detail()));
    repo.addBlock.mockResolvedValue(ok('b1'));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/manage/listings/l1/availability' });
    const days = await screen.findAllByRole('button', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d+ \w+ \d{4}$/ });
    await user.press(days[0]!);
    await user.type(screen.getByLabelText('Reason (only you see this)'), 'Exam week');
    await user.press(screen.getByTestId('block-save'));
    expect(repo.addBlock).toHaveBeenCalledWith('l1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 'Exam week');
  });
});

describe('admin listing reports', () => {
  it('requires a note to hide a reported listing', async () => {
    signIn(['admin', 'moderator']);
    moderation.listOpen.mockResolvedValue(ok([{ id: 'r1', listingId: 'l9', listingTitle: 'TI-84 Plus', listingModeration: 'reported', reason: 'Wrong model in photos', details: null, status: 'open', createdAt: '2026-11-18T02:00:00Z' }]));
    moderation.listHidden.mockResolvedValue(ok([]));
    moderation.resolve.mockResolvedValue(ok(undefined));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/admin/reports' });
    await user.press(await screen.findByTestId('report-hide-r1'));
    await user.press(screen.getByTestId('moderation-confirm'));
    expect(screen.getByText(/at least 10 characters/)).toBeOnTheScreen();
    await user.type(screen.getByLabelText('Note to the lender'), 'Photos show a different calculator.');
    await user.press(screen.getByTestId('moderation-confirm'));
    expect(moderation.resolve).toHaveBeenCalledWith('r1', 'hide', 'Photos show a different calculator.');
  });
});
