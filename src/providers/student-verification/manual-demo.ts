import { getSupabase } from '@/lib/supabase';
import { run } from '@/repositories/base';
import type { StudentVerificationProvider, VerificationSubmitted } from './types';

/**
 * Manual demo review: the submission is stored for a TigRent reviewer (admin/moderator) to approve,
 * reject or send back. No external identity service is contacted, and the UI says so.
 */
export const manualDemoVerificationProvider: StudentVerificationProvider = {
  id: 'manual_demo',
  label: 'Manual student review (demo)',
  isSimulated: true,
  description: 'A TigRent reviewer checks your details and registration form. No external verification service or UST system is connected.',
  submit: (input) =>
    run(
      getSupabase().rpc('submit_verification', {
        p_full_name: input.fullName,
        p_student_email: input.studentEmail,
        p_student_id: input.studentId,
        p_academic_year_id: input.academicYearId,
        p_requested_roles: input.requestedRoles,
        p_document_path: input.documentPath,
      }),
      (json): VerificationSubmitted => {
        const r = json as { id: string; submitted_at: string };
        return { id: r.id, status: 'pending_review', submittedAt: r.submitted_at };
      },
    ),
};

/** The provider in use. Swap here (behind configuration) when a real provider is approved. */
export const studentVerificationProvider: StudentVerificationProvider = manualDemoVerificationProvider;
