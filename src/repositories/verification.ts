import type { AcademicYear, MarketplaceRole, VerificationRecord, VerificationStatus } from '@/domain/entities';
import { getSupabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';
import { run, runMaybe } from './base';
import { toAcademicYear, toVerification } from './identity';

/** Admin-configurable verification rules (platform_settings). Values may be samples (plan §0.1.9). */
export type VerificationRules = {
  emailDomains: string[];
  studentIdPattern: string;
  maxBytes: number;
  mimeTypes: string[];
  allowNonCurrentYear: boolean;
  providerMode: string;
  isSample: boolean;
};

export const DEFAULT_RULES: VerificationRules = {
  emailDomains: [],
  studentIdPattern: '.+',
  maxBytes: 10 * 1024 * 1024,
  mimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'],
  allowNonCurrentYear: false,
  providerMode: 'manual_demo',
  isSample: true,
};

export function toVerificationRules(rows: { key: string; value: unknown; is_sample: boolean }[]): VerificationRules {
  const get = (k: string) => rows.find((r) => r.key === k);
  const doc = (get('verification_document')?.value ?? {}) as { max_bytes?: number; mime_types?: string[] };
  return {
    emailDomains: (get('email_domain_allowlist')?.value as string[] | undefined) ?? DEFAULT_RULES.emailDomains,
    studentIdPattern: (get('student_id_pattern')?.value as string | undefined) ?? DEFAULT_RULES.studentIdPattern,
    maxBytes: doc.max_bytes ?? DEFAULT_RULES.maxBytes,
    mimeTypes: doc.mime_types ?? DEFAULT_RULES.mimeTypes,
    allowNonCurrentYear: (get('allow_non_current_academic_year')?.value as boolean | undefined) ?? false,
    providerMode: (get('verification_provider_mode')?.value as string | undefined) ?? 'manual_demo',
    isSample: ['email_domain_allowlist', 'student_id_pattern'].some((k) => get(k)?.is_sample ?? true),
  };
}

const RULE_KEYS = ['email_domain_allowlist', 'student_id_pattern', 'verification_document', 'allow_non_current_academic_year', 'verification_provider_mode'];

/** Queue row: submission + academic-year label (full name is stored on the submission itself). */
export type VerificationQueueItem = VerificationRecord & {
  userId: string;
  fullName: string;
  studentEmail: string;
  studentId: string;
  documentPath: string | null;
  documentMime: string | null;
  documentSizeBytes: number | null;
  academicYearLabel: string;
  academicYearIsCurrent: boolean;
};

type QueueRow = Tables<'student_verifications'> & { academic_years: Pick<Tables<'academic_years'>, 'label' | 'is_current'> | null };

export const toQueueItem = (r: QueueRow): VerificationQueueItem => ({
  ...toVerification(r),
  userId: r.user_id,
  fullName: r.full_name,
  studentEmail: r.student_email,
  studentId: r.student_id,
  documentPath: r.document_path,
  documentMime: r.document_mime,
  documentSizeBytes: r.document_size_bytes,
  academicYearLabel: r.academic_years?.label ?? '',
  academicYearIsCurrent: r.academic_years?.is_current ?? false,
});

const QUEUE_SELECT = '*, academic_years(label, is_current)';

export type ReviewDecision = 'approve' | 'reject' | 'request_resubmission';

export const verificationRepository = {
  getRules: () =>
    run(getSupabase().from('platform_settings').select('key, value, is_sample').eq('is_current', true).in('key', RULE_KEYS), (rows) =>
      toVerificationRules(rows),
    ),

  /** The signed-in student's submissions, newest first (with academic-year labels). */
  listMine: (userId: string) =>
    run(getSupabase().from('student_verifications').select(QUEUE_SELECT).eq('user_id', userId).order('submitted_at', { ascending: false }), (rows) =>
      (rows as QueueRow[]).map(toQueueItem),
    ),

  /** Staff queue (RLS: staff can read every submission). */
  listByStatus: (status: VerificationStatus) =>
    run(
      getSupabase()
        .from('student_verifications')
        .select(QUEUE_SELECT)
        .eq('status', status)
        .order('submitted_at', { ascending: status === 'pending_review' })
        .limit(100),
      (rows) => (rows as QueueRow[]).map(toQueueItem),
    ),

  getById: (id: string) =>
    runMaybe(getSupabase().from('student_verifications').select(QUEUE_SELECT).eq('id', id).maybeSingle(), (r) => toQueueItem(r as unknown as QueueRow)),

  review: (id: string, decision: ReviewDecision, reason?: string) =>
    run(getSupabase().rpc('review_verification', { p_verification_id: id, p_decision: decision, p_reason: reason ?? null }), (json) => {
      const r = json as { status: VerificationStatus };
      return { status: r.status };
    }),
};

/** Pending count needs the response's `count`, which `run` doesn't expose. */
export async function countPendingVerifications(): Promise<number | null> {
  try {
    const { count, error } = await getSupabase().from('student_verifications').select('id', { count: 'exact', head: true }).eq('status', 'pending_review');
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

export const academicYearAdminRepository = {
  listAll: () =>
    run(getSupabase().from('academic_years').select('*').order('start_date', { ascending: false }), (rows) =>
      rows.map((r): AcademicYear & { isArchived: boolean } => ({ ...toAcademicYear(r), isArchived: r.is_archived })),
    ),
  create: (label: string, startDate: string, endDate: string) =>
    run(getSupabase().rpc('create_academic_year', { p_label: label, p_start: startDate, p_end: endDate }), (id) => id as string),
  setCurrent: (id: string) =>
    run(getSupabase().rpc('set_current_academic_year', { p_academic_year_id: id }), (json) => {
      const r = json as { academic_year: string; expired_verifications: number };
      return { label: r.academic_year, expiredVerifications: r.expired_verifications };
    }),
};

export type { MarketplaceRole };
