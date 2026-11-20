import type {
  AcademicYear,
  AppRole,
  MarketplaceRole,
  MyProfile,
  PublicProfile,
  TermsDocument,
  VerificationRecord,
} from '@/domain/entities';
import { getSupabase } from '@/lib/supabase';
import type { Tables, Views } from '@/types/database';
import { run, runMaybe } from './base';

export const toMyProfile = (r: Tables<'profiles'>): MyProfile => ({
  id: r.id,
  fullName: r.full_name,
  avatarPath: r.avatar_path,
  accountStatus: r.account_status,
  statusReason: r.status_reason,
  activeRolePref: r.active_role_pref,
});

export const toPublicProfile = (r: Views<'public_profiles'>): PublicProfile => ({
  id: r.id ?? '',
  fullName: r.full_name ?? '',
  avatarPath: r.avatar_path,
  isStudentVerified: r.is_student_verified ?? false,
  reviewCount: r.review_count ?? 0,
  ratingAvg: r.rating_avg === null ? null : Number(r.rating_avg),
  completedLendings: r.completed_lendings ?? 0,
  completedBorrowings: r.completed_borrowings ?? 0,
  memberSince: r.created_at ?? '',
});

export const toAcademicYear = (r: Tables<'academic_years'>): AcademicYear => ({
  id: r.id,
  label: r.label,
  startDate: r.start_date,
  endDate: r.end_date,
  isCurrent: r.is_current,
  isSample: r.is_sample,
});

export const toVerification = (r: Tables<'student_verifications'>): VerificationRecord => ({
  id: r.id,
  academicYearId: r.academic_year_id,
  status: r.status,
  requestedRoles: r.requested_roles,
  reviewReason: r.review_reason,
  submittedAt: r.submitted_at,
  reviewedAt: r.reviewed_at,
  expiresAt: r.expires_at,
  provider: r.provider,
});

export const profilesRepository = {
  getMine: (userId: string) =>
    run(getSupabase().from('profiles').select('*').eq('id', userId).single(), toMyProfile),

  getPublic: (userId: string) =>
    runMaybe(getSupabase().from('public_profiles').select('*').eq('id', userId).maybeSingle(), toPublicProfile),

  /** Only the columns the database grants for self-service (name, avatar, active-role preference). */
  updateMine: (userId: string, patch: { fullName?: string; activeRolePref?: MarketplaceRole | null; avatarPath?: string | null }) =>
    run(
      getSupabase()
        .from('profiles')
        .update({
          ...(patch.fullName !== undefined && { full_name: patch.fullName.trim().slice(0, 120) }),
          ...(patch.activeRolePref !== undefined && { active_role_pref: patch.activeRolePref }),
          ...(patch.avatarPath !== undefined && { avatar_path: patch.avatarPath }),
        })
        .eq('id', userId)
        .select('*')
        .single(),
      toMyProfile,
    ),
};

export const rolesRepository = {
  getMine: (userId: string) =>
    run(getSupabase().from('user_roles').select('role').eq('user_id', userId), (rows) => rows.map((r) => r.role as AppRole)),
};

export const academicYearsRepository = {
  list: () =>
    run(getSupabase().from('academic_years').select('*').eq('is_archived', false).order('start_date', { ascending: false }), (rows) =>
      rows.map(toAcademicYear),
    ),
  getCurrent: () =>
    runMaybe(getSupabase().from('academic_years').select('*').eq('is_current', true).maybeSingle(), toAcademicYear),
};

export const verificationsRepository = {
  /** Newest first; the first entry is the current state, the rest is review history. */
  listMine: (userId: string) =>
    run(
      getSupabase().from('student_verifications').select('*').eq('user_id', userId).order('submitted_at', { ascending: false }),
      (rows) => rows.map(toVerification),
    ),
};

export const termsRepository = {
  listActive: () =>
    run(getSupabase().from('terms_versions').select('*').eq('is_active', true).order('doc_type'), (rows) =>
      rows.map(
        (r): TermsDocument => ({ id: r.id, docType: r.doc_type, version: r.version, title: r.title, content: r.content, isSample: r.is_sample }),
      ),
    ),
};
