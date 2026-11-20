import path from 'path';
import { renderRouter, screen } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import type { SessionState } from '@/features/auth/route-resolver';
import { __setSessionForTests } from '@/features/auth/session';
import { AppError, fail, ok } from '@/lib/errors';
import { studentVerificationProvider } from '@/providers/student-verification/manual-demo';
import { academicYearsRepository, verificationRepository, type SessionContext, type VerificationQueueItem } from '@/repositories';

jest.mock('@/repositories', () => ({
  academicYearsRepository: { list: jest.fn() },
  verificationRepository: { getRules: jest.fn(), listMine: jest.fn(), listByStatus: jest.fn(), getById: jest.fn(), review: jest.fn() },
  academicYearAdminRepository: { listAll: jest.fn() },
  countPendingVerifications: jest.fn(async () => 1),
  profilesRepository: { updateMine: jest.fn() },
}));
jest.mock('@/providers/student-verification/manual-demo', () => ({
  studentVerificationProvider: { id: 'manual_demo', label: 'Manual student review (demo)', isSimulated: true, description: 'No external service.', submit: jest.fn() },
}));
jest.mock('@/providers/storage/private-upload', () => ({
  signedUrlFor: jest.fn(async () => ({ ok: true, data: 'https://example.invalid/signed' })),
}));
// The real picker/upload field needs native modules; this stand-in "uploads" on press.
jest.mock('@/features/verification/DocumentField', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories can't use imports
  const { Pressable, Text } = require('react-native') as typeof import('react-native');
  return {
  DocumentField: ({ value, onChange, error }: { value: unknown; onChange: (d: unknown) => void; error?: string }) => (
    <>
      <Pressable accessibilityRole="button" onPress={() => onChange({ path: 'u1/1-abc.pdf', name: 'form.pdf', mimeType: 'application/pdf', size: 1000, previewUri: '' })}>
        <Text>{value ? 'Document ready' : 'Add registration form'}</Text>
      </Pressable>
      {error ? <Text>{error}</Text> : null}
    </>
  ),
  };
});

const APP_DIR = path.resolve(__dirname, '../../app');
const repo = jest.mocked(verificationRepository);
const years = jest.mocked(academicYearsRepository);
const provider = jest.mocked(studentVerificationProvider);

const RULES = { emailDomains: ['ust.edu.ph'], studentIdPattern: '^[0-9-]{4,20}$', maxBytes: 10485760, mimeTypes: ['application/pdf'], allowNonCurrentYear: false, providerMode: 'manual_demo', isSample: true };
const YEARS = [{ id: 'cur', label: 'AY 2026–2027', startDate: '2026-08-01', endDate: '2027-07-31', isCurrent: true, isSample: true }];
const item = (o: Partial<VerificationQueueItem> = {}): VerificationQueueItem => ({
  id: 'v1', academicYearId: 'cur', status: 'pending_review', requestedRoles: ['borrower'], reviewReason: null, submittedAt: '2026-11-18T02:00:00Z',
  reviewedAt: null, expiresAt: null, provider: 'manual_demo', userId: 'u9', fullName: 'Paolo Lim', studentEmail: 'paolo@ust.edu.ph', studentId: 'DEMO-0005',
  documentPath: 'u9/registration-form-SAMPLE.pdf', documentMime: 'application/pdf', documentSizeBytes: 48213, academicYearLabel: 'AY 2026–2027', academicYearIsCurrent: true, ...o,
});

function as(verification: SessionContext['verificationStatus'], roles: SessionContext['roles'] = [], extra = {}) {
  const state: SessionState = { kind: 'signed_in', roles, verification, accountStatus: 'active', termsAccepted: true, activeRole: null };
  const context: SessionContext = { userId: 'u1', fullName: 'Juan Dela Cruz', accountStatus: 'active', statusReason: null, activeRolePref: null, roles, verificationStatus: verification, pendingTerms: [] };
  __setSessionForTests(state, { context, ...extra });
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.getRules.mockResolvedValue(ok(RULES));
  years.list.mockResolvedValue(ok(YEARS));
  repo.listMine.mockResolvedValue(ok([]));
});
afterAll(() => __setSessionForTests(null));

describe('verification form', () => {
  it('shows the honest provider label and validates against configured rules before submitting', async () => {
    as('not_submitted');
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/onboarding/verification' });
    expect(await screen.findByText('Manual student review (demo)')).toBeOnTheScreen();
    await user.type(screen.getByLabelText('University email'), 'juan@gmail.com');
    await user.press(screen.getByTestId('verification-submit'));
    expect(await screen.findByText('Use your university email (ust.edu.ph).')).toBeOnTheScreen();
    expect(screen.getByText('Enter your student ID.')).toBeOnTheScreen();
    expect(screen.getByText('Choose whether you want to borrow, lend, or both.')).toBeOnTheScreen();
    expect(screen.getByText('Upload your registration form.')).toBeOnTheScreen();
    expect(provider.submit).not.toHaveBeenCalled();
  });

  it('submits a complete form and moves to the status screen', async () => {
    const refresh = jest.fn(async () => undefined);
    as('not_submitted', [], { refresh });
    provider.submit.mockResolvedValue(ok({ id: 'v1', status: 'pending_review', submittedAt: '2026-11-18T02:00:00Z' }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/onboarding/verification' });
    await user.type(await screen.findByLabelText('University email'), 'juan@ust.edu.ph');
    await user.type(screen.getByLabelText('Student ID'), '2026-12345');
    await user.press(screen.getByRole('checkbox', { name: 'Lend my equipment' }));
    await user.press(screen.getByRole('button', { name: 'Add registration form' }));
    await user.press(screen.getByTestId('verification-submit'));
    expect(provider.submit).toHaveBeenCalledWith({
      fullName: 'Juan Dela Cruz', studentEmail: 'juan@ust.edu.ph', studentId: '2026-12345', academicYearId: 'cur', requestedRoles: ['lender'], documentPath: 'u1/1-abc.pdf',
    });
    expect(refresh).toHaveBeenCalled();
    expect(screen).toHavePathname('/onboarding/status');
  });

  it('shows server-side validation on the right field', async () => {
    as('not_submitted');
    provider.submit.mockResolvedValue(fail(new AppError('validation', 'Check your student ID format.', 'student_id')));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/onboarding/verification' });
    await user.type(await screen.findByLabelText('University email'), 'juan@ust.edu.ph');
    await user.type(screen.getByLabelText('Student ID'), '2026-12345');
    await user.press(screen.getByRole('checkbox', { name: 'Borrow equipment' }));
    await user.press(screen.getByRole('button', { name: 'Add registration form' }));
    await user.press(screen.getByTestId('verification-submit'));
    expect(await screen.findByText('Check your student ID format.')).toBeOnTheScreen();
  });

  it('a rejected student sees the reviewer’s reason and a prefilled form for resubmission', async () => {
    as('rejected');
    repo.listMine.mockResolvedValue(ok([item({ status: 'rejected', reviewReason: 'Form is for a previous term.', userId: 'u1', fullName: 'Juan D. Cruz' })]));
    await renderRouter(APP_DIR, { initialUrl: '/onboarding/verification' });
    expect(await screen.findByText('Form is for a previous term.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Full name')).toHaveDisplayValue('Juan D. Cruz');
  });
});

describe('status screen', () => {
  it('pending: explains the wait, shows Tiggy’s tip on tap, and can check for updates', async () => {
    const refresh = jest.fn(async () => undefined);
    as('pending_review', [], { refresh });
    repo.listMine.mockResolvedValue(ok([item({ userId: 'u1' })]));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/onboarding/status' });
    expect(await screen.findByText('Waiting for review')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: /Tiggy/ }));
    expect(screen.getByText(/waiting for review\. I’ll let you know/)).toBeOnTheScreen();
    await user.press(screen.getByTestId('status-refresh'));
    expect(refresh).toHaveBeenCalled();
  });

  it('rejected: shows the reason and a resubmit action', async () => {
    as('rejected');
    repo.listMine.mockResolvedValue(ok([item({ status: 'rejected', reviewReason: 'Blurry photo of the form.' })]));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/onboarding/status' });
    expect(await screen.findByText('Blurry photo of the form.')).toBeOnTheScreen();
    await user.press(screen.getByTestId('status-resubmit'));
    expect(screen).toHavePathname('/onboarding/verification');
  });
});

describe('admin review', () => {
  const admin = () => as('not_submitted', ['admin', 'moderator']);

  it('lists the pending queue and opens a submission', async () => {
    admin();
    repo.listByStatus.mockResolvedValue(ok([item()]));
    repo.getById.mockResolvedValue(ok(item()));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/admin/verifications' });
    await user.press(await screen.findByTestId('queue-v1'));
    expect(screen).toHavePathname('/admin/verifications/v1');
    expect(await screen.findByText('DEMO-0005')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open document' })).toBeOnTheScreen();
  });

  it('approves after confirmation', async () => {
    admin();
    repo.getById.mockResolvedValue(ok(item()));
    repo.review.mockResolvedValue(ok({ status: 'verified' }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/admin/verifications/v1' });
    await user.press(await screen.findByTestId('review-approve'));
    await user.press(screen.getByTestId('approve-dialog-confirm'));
    expect(repo.review).toHaveBeenCalledWith('v1', 'approve', undefined);
  });

  it('requires a reason to reject', async () => {
    admin();
    repo.getById.mockResolvedValue(ok(item()));
    repo.review.mockResolvedValue(ok({ status: 'rejected' }));
    const user = userEvent.setup();
    await renderRouter(APP_DIR, { initialUrl: '/admin/verifications/v1' });
    await user.press(await screen.findByTestId('review-reject'));
    await user.press(screen.getByTestId('review-confirm-reason'));
    expect(screen.getByText(/at least 10 characters/)).toBeOnTheScreen();
    expect(repo.review).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Reason'), 'The form is for a previous term.');
    await user.press(screen.getByTestId('review-confirm-reason'));
    expect(repo.review).toHaveBeenCalledWith('v1', 'reject', 'The form is for a previous term.');
  });

  it('never offers decisions on the reviewer’s own submission', async () => {
    admin();
    repo.getById.mockResolvedValue(ok(item({ userId: 'u1' })));
    await renderRouter(APP_DIR, { initialUrl: '/admin/verifications/v1' });
    expect(await screen.findByText('This is your own submission')).toBeOnTheScreen();
    expect(screen.queryByTestId('review-approve')).not.toBeOnTheScreen();
  });
});
