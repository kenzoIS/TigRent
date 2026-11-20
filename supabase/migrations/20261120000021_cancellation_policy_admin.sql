-- Phase 12: safely version and activate cancellation policies without violating the one-active-policy index.
create function public.create_cancellation_policy(p_label text, p_rules jsonb, p_is_sample boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_label text := trim(coalesce(p_label, '')); v_version integer; v_row public.cancellation_policy_versions;
begin
  if not app_private.has_role('admin') then raise exception 'forbidden.admin_only' using errcode = 'P0001', hint = 'Only administrators can change cancellation policy.'; end if;
  if char_length(v_label) not between 3 and 160 then raise exception 'validation.label' using errcode = 'P0001', hint = 'Enter a policy label from 3 to 160 characters.'; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' or not (p_rules ? 'pending_cancel_by_borrower' and p_rules ? 'borrower_cancel_before_pickup' and p_rules ? 'lender_cancel_before_pickup' and p_rules ? 'after_pickup') then
    raise exception 'validation.policy' using errcode = 'P0001', hint = 'The policy must include each required cancellation scenario.';
  end if;
  perform pg_advisory_xact_lock(hashtext('cancellation_policy_versions'));
  select coalesce(max(version), 0) + 1 into v_version from public.cancellation_policy_versions;
  update public.cancellation_policy_versions set is_active = false where is_active;
  insert into public.cancellation_policy_versions (version, label, rules, is_sample, is_active, created_by)
    values (v_version, v_label, p_rules, coalesce(p_is_sample, true), true, auth.uid()) returning * into v_row;
  perform app_private.audit('cancellation_policy.activated', 'cancellation_policy', v_row.id::text, jsonb_build_object('version', v_row.version, 'label', v_row.label));
  return jsonb_build_object('id', v_row.id, 'version', v_row.version, 'label', v_row.label, 'is_sample', v_row.is_sample, 'rules', v_row.rules);
end
$$;
revoke all on function public.create_cancellation_policy(text,jsonb,boolean) from public, anon;
grant execute on function public.create_cancellation_policy(text,jsonb,boolean) to authenticated;
