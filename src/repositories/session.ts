import type { AccountStatus, AppRole, MarketplaceRole, TermsDocType, VerificationStatus } from '@/domain/entities';
import { getSupabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import { run } from './base';

/** Server-held session facts (RPC get_my_session_context). Never derived from local state. */
export type SessionContext = {
  userId: string;
  fullName: string;
  accountStatus: AccountStatus;
  statusReason: string | null;
  activeRolePref: MarketplaceRole | null;
  roles: AppRole[];
  verificationStatus: VerificationStatus;
  pendingTerms: { id: string; docType: TermsDocType; version: number }[];
};

type RawContext = {
  user_id: string;
  full_name: string;
  account_status: AccountStatus;
  status_reason: string | null;
  active_role_pref: MarketplaceRole | null;
  roles: AppRole[];
  verification_status: VerificationStatus;
  pending_terms: { id: string; doc_type: TermsDocType; version: number }[];
};

export const toSessionContext = (json: Json): SessionContext => {
  const r = json as unknown as RawContext;
  return {
    userId: r.user_id,
    fullName: r.full_name,
    accountStatus: r.account_status,
    statusReason: r.status_reason,
    activeRolePref: r.active_role_pref,
    roles: r.roles ?? [],
    verificationStatus: r.verification_status,
    pendingTerms: (r.pending_terms ?? []).map((t) => ({ id: t.id, docType: t.doc_type, version: t.version })),
  };
};

export const sessionRepository = {
  getContext: () => run(getSupabase().rpc('get_my_session_context'), toSessionContext),
  acceptTerms: (versionIds: string[]) => run(getSupabase().rpc('accept_current_terms', { p_version_ids: versionIds }), toSessionContext),
  enableRole: (role: MarketplaceRole) => run(getSupabase().rpc('enable_marketplace_role', { p_role: role }), toSessionContext),
};
