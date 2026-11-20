/**
 * Client-side checks for the verification form, built from the SAME admin-configured rules the server
 * enforces (submit_verification). They improve feedback only; the server stays authoritative (§10.2).
 */
import { z } from 'zod';
import type { AcademicYear } from '@/domain/entities';
import { formatBytes } from '@/lib/format';
import type { VerificationRules } from '@/repositories';
import { emailSchema, fullNameSchema } from '@/features/auth/validation';

export type VerificationField = 'fullName' | 'studentEmail' | 'studentId' | 'academicYearId' | 'roles' | 'document';

export function buildVerificationSchema(rules: VerificationRules, years: AcademicYear[]) {
  let idPattern: RegExp | null = null;
  try {
    idPattern = new RegExp(rules.studentIdPattern);
  } catch {
    idPattern = null; // an invalid admin pattern is left to the server to judge
  }
  return z.object({
    fullName: fullNameSchema,
    studentEmail: emailSchema.refine(
      (e) => rules.emailDomains.includes(e.split('@')[1]?.toLowerCase() ?? ''),
      `Use your university email (${rules.emailDomains.join(', ')}).`,
    ),
    studentId: z
      .string()
      .trim()
      .min(1, 'Enter your student ID.')
      .refine((v) => !idPattern || idPattern.test(v), 'Check your student ID format.'),
    academicYearId: z
      .string({ error: 'Choose the academic year of your registration form.' })
      .min(1, 'Choose the academic year of your registration form.')
      .refine((id) => {
        const y = years.find((x) => x.id === id);
        return Boolean(y && (y.isCurrent || rules.allowNonCurrentYear));
      }, 'Submit a registration form for the current academic year.'),
    roles: z.array(z.enum(['borrower', 'lender'])).min(1, 'Choose whether you want to borrow, lend, or both.'),
    documentPath: z.string({ error: 'Upload your registration form.' }).min(1, 'Upload your registration form.'),
  });
}

/** Pre-upload file check (type and size) against the configured limits. Returns an error or null. */
export function checkFile(file: { mimeType?: string | null; size?: number | null }, rules: VerificationRules): string | null {
  const mime = (file.mimeType ?? '').toLowerCase();
  if (!mime || !rules.mimeTypes.includes(mime)) return 'Use a PDF, JPG, PNG or HEIC file.';
  if (file.size === 0) return 'That file is empty. Choose another one.';
  if (file.size != null && file.size > rules.maxBytes) return `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(rules.maxBytes)}.`;
  return null;
}

/** Maps server error codes (validation.<reason>) to the form field that should show them. */
export const SERVER_ERROR_FIELD: Record<string, VerificationField> = {
  full_name: 'fullName',
  student_email: 'studentEmail',
  student_email_domain: 'studentEmail',
  student_id: 'studentId',
  academic_year: 'academicYearId',
  academic_year_not_current: 'academicYearId',
  roles: 'roles',
  document: 'document',
  document_missing: 'document',
  document_size: 'document',
  document_type: 'document',
  document_reused: 'document',
};
