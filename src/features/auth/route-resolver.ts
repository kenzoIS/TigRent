/**
 * Decides which area of the app a session belongs in (plan §2.1, §2.2, Phase 3 guards).
 * UI routing only: every protected action is ALSO enforced server-side (plan §6.5).
 */
export type MarketplaceRole = 'borrower' | 'lender';
export type AppRole = MarketplaceRole | 'admin' | 'moderator';
export type VerificationStatus = 'not_submitted' | 'pending_review' | 'verified' | 'rejected' | 'needs_resubmission' | 'expired';
export type AccountStatus = 'active' | 'paused_pending_review' | 'restricted' | 'suspended';

export type SessionState =
  | { kind: 'loading' }
  | { kind: 'signed_out' }
  /** Signed in, but the server context could not be loaded (e.g. offline at launch). */
  | { kind: 'error'; message: string; offline: boolean }
  | { kind: 'email_unconfirmed' }
  | {
      kind: 'signed_in';
      roles: readonly AppRole[];
      verification: VerificationStatus;
      accountStatus: AccountStatus;
      termsAccepted: boolean;
      /** UI preference only, never an authorization input. */
      activeRole: MarketplaceRole | null;
    };

export type AppArea =
  | '/loading'
  | '/welcome'
  | '/check-email'
  | '/onboarding/terms'
  | '/onboarding/verification'
  | '/onboarding/status'
  | '/restricted'
  | '/admin'
  | '/borrower'
  | '/lender';

export function resolveHome(s: SessionState): AppArea {
  switch (s.kind) {
    case 'loading':
    case 'error':
      return '/loading';
    case 'signed_out':
      return '/welcome';
    case 'email_unconfirmed':
      return '/check-email';
    case 'signed_in':
      break;
  }
  if (s.roles.includes('admin') || s.roles.includes('moderator')) return '/admin';
  if (!s.termsAccepted) return '/onboarding/terms';
  // Restricted/suspended accounts keep access to status, support, appeal and existing rentals (plan §2.9).
  if (s.accountStatus !== 'active') return '/restricted';
  if (s.verification === 'not_submitted') return '/onboarding/verification';
  if (s.verification !== 'verified') return '/onboarding/status';
  return marketplaceHome(s.roles, s.activeRole);
}

/** Borrower vs lender home for a verified, active student. */
export function marketplaceHome(roles: readonly AppRole[], activeRole: MarketplaceRole | null): '/borrower' | '/lender' | '/onboarding/status' {
  const hasBorrower = roles.includes('borrower');
  const hasLender = roles.includes('lender');
  if (hasBorrower && hasLender) return activeRole === 'lender' ? '/lender' : '/borrower';
  if (hasLender) return '/lender';
  if (hasBorrower) return '/borrower';
  return '/onboarding/status'; // verified but no marketplace role enabled yet
}

/** Whether a session may open a given role area (deep-link guard). */
export function canEnterArea(s: SessionState, area: 'borrower' | 'lender' | 'admin'): boolean {
  if (s.kind !== 'signed_in') return false;
  if (area === 'admin') return s.roles.includes('admin') || s.roles.includes('moderator');
  if (!s.termsAccepted || s.verification !== 'verified') return false;
  // Restricted users may still view existing rentals inside role areas; new actions are blocked server-side.
  return s.roles.includes(area);
}
