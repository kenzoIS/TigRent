/**
 * Student verification provider boundary (plan §2.2, §6.1 layer 5). Today only the manual demo
 * review exists. A future SheerID (or other approved) adapter implements this same interface; the
 * database already stores provider / provider_ref / provider_status. See docs/VERIFICATION_PROVIDERS.md.
 */
import type { MarketplaceRole } from '@/domain/entities';
import type { Result } from '@/lib/errors';

export type VerificationSubmission = {
  fullName: string;
  studentEmail: string;
  studentId: string;
  academicYearId: string;
  requestedRoles: MarketplaceRole[];
  /** Path of the already-uploaded private document (verification-docs/{user_id}/…). */
  documentPath: string;
};

export type VerificationSubmitted = { id: string; status: 'pending_review'; submittedAt: string };

export interface StudentVerificationProvider {
  /** Stable identifier stored on each submission (e.g. 'manual_demo', later 'sheerid'). */
  readonly id: string;
  /** Honest, user-facing label (plan §10.4). */
  readonly label: string;
  /** True when no external third party is involved. */
  readonly isSimulated: boolean;
  readonly description: string;
  submit(input: VerificationSubmission): Promise<Result<VerificationSubmitted>>;
}
