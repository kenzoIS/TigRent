import { buildVerificationSchema, checkFile } from '@/features/verification/validation';
import { formatBytes } from '@/lib/format';
import { buildObjectPath } from '@/providers/storage/private-upload';
import { toVerificationRules, type VerificationRules } from '@/repositories/verification';

const rules: VerificationRules = {
  emailDomains: ['ust.edu.ph', 'tigrent.test'],
  studentIdPattern: '^[A-Za-z0-9-]{4,20}$',
  maxBytes: 10 * 1024 * 1024,
  mimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'],
  allowNonCurrentYear: false,
  providerMode: 'manual_demo',
  isSample: true,
};
const years = [
  { id: 'cur', label: 'AY 2026–2027', startDate: '2026-08-01', endDate: '2027-07-31', isCurrent: true, isSample: true },
  { id: 'old', label: 'AY 2025–2026', startDate: '2025-08-01', endDate: '2026-07-31', isCurrent: false, isSample: true },
];
const valid = { fullName: 'Juan Dela Cruz', studentEmail: 'juan@ust.edu.ph', studentId: '2026-12345', academicYearId: 'cur', roles: ['borrower'], documentPath: 'u/f.pdf' };

describe('verification form rules (same configured values as the server)', () => {
  const schema = buildVerificationSchema(rules, years);
  it('accepts a complete submission', () => expect(schema.safeParse(valid).success).toBe(true));
  it.each([
    ['non-university domain', { studentEmail: 'juan@gmail.com' }, /university email \(ust\.edu\.ph, tigrent\.test\)/],
    ['bad student ID', { studentId: 'x' }, /student ID format/],
    ['non-current year', { academicYearId: 'old' }, /current academic year/],
    ['no role', { roles: [] }, /borrow, lend, or both/],
    ['missing document', { documentPath: undefined }, /Upload your registration form/],
  ])('%s', (_l, patch, msg) => {
    const r = schema.safeParse({ ...valid, ...patch });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message).join(' ')).toMatch(msg);
  });
  it('honours the admin exception for non-current years', () => {
    expect(buildVerificationSchema({ ...rules, allowNonCurrentYear: true }, years).safeParse({ ...valid, academicYearId: 'old' }).success).toBe(true);
  });
});

describe('file pre-checks', () => {
  it('rejects disallowed types, empty and oversized files', () => {
    expect(checkFile({ mimeType: 'text/html', size: 100 }, rules)).toMatch(/PDF, JPG, PNG or HEIC/);
    expect(checkFile({ mimeType: 'application/pdf', size: 0 }, rules)).toMatch(/empty/);
    expect(checkFile({ mimeType: 'application/pdf', size: 12 * 1024 * 1024 }, rules)).toMatch(/12 MB\. The limit is 10 MB/);
    expect(checkFile({ mimeType: 'image/jpeg', size: 2_000_000 }, rules)).toBeNull();
  });
});

describe('storage paths never contain user filenames', () => {
  const uid = 'aaaaaaaa-0000-4000-8000-000000000005';
  it('builds {user_id}/{timestamp}-{random}.{ext}', () => {
    expect(buildObjectPath(uid, 'application/pdf', 1763452800000, 'k3j9x2')).toBe(`${uid}/1763452800000-k3j9x2.pdf`);
    expect(buildObjectPath(uid, 'image/jpeg', 1, '../../etc')).toBe(`${uid}/1-etc.jpg`);
  });
  it('refuses unknown types and non-id folders', () => {
    expect(() => buildObjectPath(uid, 'text/html')).toThrow(RangeError);
    expect(() => buildObjectPath('../other', 'application/pdf')).toThrow(RangeError);
  });
});

describe('settings mapping and formatting', () => {
  it('reads rules from versioned settings rows', () => {
    const r = toVerificationRules([
      { key: 'email_domain_allowlist', value: ['ust.edu.ph'], is_sample: true },
      { key: 'verification_document', value: { max_bytes: 5, mime_types: ['application/pdf'] }, is_sample: true },
    ]);
    expect(r).toMatchObject({ emailDomains: ['ust.edu.ph'], maxBytes: 5, mimeTypes: ['application/pdf'], isSample: true });
  });
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(48213)).toBe('47 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
  });
});
