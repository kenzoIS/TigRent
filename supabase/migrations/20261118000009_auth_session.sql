-- Phase 3: session context, terms acceptance, role enablement (plan §2.1, §2.2, Journey A.4).
--
-- RPC error convention: RAISE ... USING ERRCODE = 'P0001', MESSAGE = '<kind>.<reason>', HINT = '<user-facing text>'
--   kind ∈ forbidden | conflict | not_found | validation | unauthenticated

-- One consistent read of everything routing needs. Roles and statuses come from the server, never
-- from client state (plan §2.1: "a selected/active role is a UI preference, not an authorization mechanism").
create function public.get_my_session_context() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    raise exception 'not_found.profile' using errcode = 'P0001', hint = 'Your profile could not be found. Please contact TigRent support.';
  end if;
  return jsonb_build_object(
    'user_id', v_profile.id,
    'full_name', v_profile.full_name,
    'account_status', v_profile.account_status,
    'status_reason', v_profile.status_reason,
    'active_role_pref', v_profile.active_role_pref,
    'roles', coalesce((select jsonb_agg(r.role order by r.role) from public.user_roles r where r.user_id = v_uid), '[]'::jsonb),
    'verification_status', app_private.verification_status(v_uid),
    'pending_terms', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'doc_type', t.doc_type, 'version', t.version) order by t.doc_type)
        from public.terms_versions t
       where t.is_active and t.doc_type in ('tos', 'privacy')
         and not exists (select 1 from public.terms_acceptances a where a.user_id = v_uid and a.terms_version_id = t.id)
    ), '[]'::jsonb)
  );
end
$$;

-- Accept the Terms of Service and Privacy Notice versions the user was shown.
-- Rejects stale versions so a user can never "accept" text that is no longer in force.
create function public.accept_current_terms(p_version_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_required uuid[];
begin
  if v_uid is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  select coalesce(array_agg(id), '{}') into v_required
    from public.terms_versions where is_active and doc_type in ('tos', 'privacy');
  if not (v_required <@ coalesce(p_version_ids, '{}') and coalesce(p_version_ids, '{}') <@ v_required) then
    raise exception 'conflict.terms_outdated' using errcode = 'P0001',
      hint = 'The Terms or Privacy Notice changed while you were reading. Please review the latest version.';
  end if;
  insert into public.terms_acceptances (user_id, terms_version_id, context)
  select v_uid, unnest(v_required), 'onboarding'
  on conflict (user_id, terms_version_id, context) do nothing;
  perform app_private.audit('terms.accepted', 'profile', v_uid::text, jsonb_build_object('versions', to_jsonb(v_required)));
  return public.get_my_session_context();
end
$$;

-- Enable borrower or lender capability on the same account (plan §2.1). Idempotent.
create function public.enable_marketplace_role(p_role public.marketplace_role) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_status public.account_status;
begin
  if v_uid is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  if app_private.verification_status(v_uid) <> 'verified' then
    raise exception 'forbidden.not_verified' using errcode = 'P0001',
      hint = 'Only verified students can enable borrowing or lending.';
  end if;
  select account_status into v_status from public.profiles where id = v_uid;
  if v_status <> 'active' then
    raise exception 'forbidden.account_restricted' using errcode = 'P0001',
      hint = 'New roles can’t be enabled while your account is under review.';
  end if;
  insert into public.user_roles (user_id, role, granted_by) values (v_uid, p_role::text::public.app_role, v_uid)
  on conflict do nothing;
  if found then
    perform app_private.audit('role.enabled', 'profile', v_uid::text, jsonb_build_object('role', p_role));
  end if;
  return public.get_my_session_context();
end
$$;

revoke all on function public.get_my_session_context(), public.accept_current_terms(uuid[]),
  public.enable_marketplace_role(public.marketplace_role) from public, anon;
grant execute on function public.get_my_session_context(), public.accept_current_terms(uuid[]),
  public.enable_marketplace_role(public.marketplace_role) to authenticated;
