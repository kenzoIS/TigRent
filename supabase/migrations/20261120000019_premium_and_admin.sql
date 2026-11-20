-- Phase 12: simulated Premium, ledger-backed lender analytics, and audited admin configuration.
-- All checkout and payout wording remains demonstrative; no real payment credentials are handled.

create function app_private.expire_my_premium(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.subscriptions
     set status = 'expired'
   where user_id = p_user and status = 'active' and period_end <= now();
end
$$;

create function public.get_my_premium() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions; v_price bigint := coalesce((app_private.setting('premium_price_centavos'))::bigint, 9900);
begin
  if auth.uid() is null then raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.'; end if;
  perform app_private.expire_my_premium(auth.uid());
  select * into s from public.subscriptions where user_id = auth.uid() order by created_at desc limit 1;
  return jsonb_build_object('id', s.id, 'status', coalesce(s.status, 'inactive'::public.subscription_status),
    'price', coalesce(s.price, v_price), 'period_start', s.period_start, 'period_end', s.period_end,
    'is_active', coalesce(s.status = 'active' and s.period_end > now(), false), 'is_sample',
    coalesce((select is_sample from public.platform_settings where key = 'premium_price_centavos' and is_current), false));
end
$$;

create function public.subscribe_premium_demo(p_idempotency_key text, p_scenario text default 'success') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); s public.subscriptions; p public.payments; v_price bigint := coalesce((app_private.setting('premium_price_centavos'))::bigint, 9900); v_mode text := coalesce(app_private.setting('payment_provider_mode') #>> '{}', 'mock_user_choice'); v_ok boolean;
begin
  if v_uid is null then raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.'; end if;
  if not app_private.has_role('lender') or not app_private.is_verified_student() then raise exception 'forbidden.not_lender' using errcode = 'P0001', hint = 'Only verified lenders can subscribe to Premium.'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and account_status = 'active') then raise exception 'forbidden.account_restricted' using errcode = 'P0001', hint = 'Your account can’t start a new subscription while restricted.'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then raise exception 'validation.idempotency_key' using errcode = 'P0001', hint = 'Please try checkout again.'; end if;
  select * into p from public.payments where idempotency_key = p_idempotency_key;
  if p.id is not null then return jsonb_build_object('subscription_id', p.subscription_id, 'payment_id', p.id, 'status', p.status); end if;
  perform app_private.expire_my_premium(v_uid);
  select * into s from public.subscriptions where user_id = v_uid and status = 'active' for update;
  if s.id is not null then raise exception 'conflict.premium_active' using errcode = 'P0001', hint = 'Premium is already active until ' || to_char(s.period_end at time zone 'Asia/Manila', 'Mon DD, YYYY') || '.'; end if;
  v_ok := case when v_mode = 'mock_always_succeed' then true when v_mode = 'mock_always_fail' then false else p_scenario = 'success' end;
  insert into public.subscriptions (user_id, status, price, period_start, period_end, cancelled_at)
    values (v_uid, case when v_ok then 'active' else 'payment_failed' end, v_price, case when v_ok then now() end, case when v_ok then now() + interval '1 month' end, null) returning * into s;
  insert into public.payments (purpose, subscription_id, payer_id, amount, provider, status, idempotency_key, provider_ref, failure_reason, processed_at)
    values ('subscription', s.id, v_uid, v_price, 'mock', case when v_ok then 'succeeded' else 'failed' end, p_idempotency_key,
      'MOCK-PREMIUM-' || replace(s.id::text, '-', ''), case when v_ok then null else 'Demo payment failed' end, now()) returning * into p;
  if v_ok then
    insert into public.ledger_entries (payment_id, subscription_id, party_id, category, debit, credit, description, idempotency_key) values
      (p.id, s.id, v_uid, 'subscription_payment', v_price, 0, 'Simulated TigRent Premium subscription', 'premium:' || s.id || ':payer'),
      (p.id, s.id, null, 'subscription_payment', 0, v_price, 'Simulated TigRent Premium revenue', 'premium:' || s.id || ':platform');
    perform app_private.notify(v_uid, 'premium.active', 'TigRent Premium is active', 'Demo subscription active for one month. No real money moved.', 'subscription', s.id, 'premium:' || s.id || ':active');
  else
    perform app_private.notify(v_uid, 'premium.payment_failed', 'Premium demo payment failed', 'No money moved. You can try the simulated checkout again.', 'subscription', s.id, 'premium:' || s.id || ':failed');
  end if;
  perform app_private.audit('premium.' || case when v_ok then 'active' else 'payment_failed' end, 'subscription', s.id::text, jsonb_build_object('price', v_price, 'demo', true));
  return jsonb_build_object('subscription_id', s.id, 'payment_id', p.id, 'status', p.status, 'period_end', s.period_end);
end
$$;

create function public.cancel_premium() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions;
begin
  if auth.uid() is null then raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.'; end if;
  perform app_private.expire_my_premium(auth.uid());
  select * into s from public.subscriptions where user_id = auth.uid() and status = 'active' for update;
  if s.id is null then raise exception 'conflict.no_premium' using errcode = 'P0001', hint = 'There is no active Premium plan to cancel.'; end if;
  update public.subscriptions set status = 'cancelled', cancelled_at = now() where id = s.id returning * into s;
  perform app_private.audit('premium.cancelled', 'subscription', s.id::text, jsonb_build_object('demo', true));
  return jsonb_build_object('id', s.id, 'status', s.status, 'period_end', s.period_end);
end
$$;

create function app_private.require_premium(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.expire_my_premium(p_user);
  if not exists (select 1 from public.subscriptions where user_id = p_user and status = 'active' and period_end > now()) then
    raise exception 'forbidden.premium_required' using errcode = 'P0001', hint = 'This is a TigRent Premium demo feature. Start the simulated subscription to unlock it.';
  end if;
end
$$;

create function public.set_featured_listing(p_listing_id uuid, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.listings;
begin
  select * into l from public.listings where id = p_listing_id for update;
  if l.id is null or l.lender_id <> auth.uid() then raise exception 'not_found.listing' using errcode = 'P0001', hint = 'This listing could not be found.'; end if;
  if p_enabled then
    perform app_private.require_premium(auth.uid());
    if l.status <> 'active' or l.moderation_status = 'hidden' then raise exception 'conflict.listing_not_active' using errcode = 'P0001', hint = 'Only active, visible listings can be featured.'; end if;
  end if;
  update public.listings set is_featured = coalesce(p_enabled, false), featured_until = case when p_enabled then now() + interval '30 days' else null end where id = l.id returning * into l;
  perform app_private.audit('listing.featured', 'listing', l.id::text, jsonb_build_object('enabled', l.is_featured));
  return jsonb_build_object('id', l.id, 'is_featured', l.is_featured, 'featured_until', l.featured_until);
end
$$;

create function public.get_lender_analytics() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.'; end if;
  perform app_private.require_premium(v_uid);
  return jsonb_build_object(
    'completed_rentals', (select count(*) from public.bookings where lender_id = v_uid and status = 'completed'),
    'active_listings', (select count(*) from public.listings where lender_id = v_uid and status = 'active'),
    'featured_listings', (select count(*) from public.listings where lender_id = v_uid and is_featured and featured_until > now()),
    'gross_rent', coalesce((select sum(subtotal) from public.bookings where lender_id = v_uid and status in ('completed','active','overdue','return_requested','disputed')), 0),
    'estimated_net', public.my_lender_earnings(),
    'is_simulated', true
  );
end
$$;

create function public.update_platform_setting(p_key text, p_value jsonb, p_description text, p_is_sample boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_old public.platform_settings; v_version integer;
begin
  if not app_private.has_role('admin') then raise exception 'forbidden.admin_only' using errcode = 'P0001', hint = 'Only administrators can change platform settings.'; end if;
  if p_key not in ('commission_bps','commission_on_late_fees','commission_on_damage','payment_hold_minutes','return_due_time_local','late_day_rounding','email_domain_allowlist','student_id_pattern','allow_non_current_academic_year','verification_expiry','verification_document','account_health_rule','trusted_lender_rule','premium_price_centavos','payment_provider_mode','verification_provider_mode','max_rental_days','max_advance_days','handover_opens_days_before','reminder_due_soon_hours','reminder_followup_hours','dispute_appeal_days','review_window_days') then raise exception 'validation.setting_key' using errcode = 'P0001', hint = 'This setting is not configurable here.'; end if;
  if p_value is null or p_description is null or char_length(trim(p_description)) not between 3 and 500 then raise exception 'validation.setting' using errcode = 'P0001', hint = 'Enter a valid value and a 3 to 500 character description.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_key));
  select * into v_old from public.platform_settings where key = p_key and is_current for update;
  if v_old.id is null then raise exception 'not_found.setting' using errcode = 'P0001', hint = 'Setting not found.'; end if;
  update public.platform_settings set is_current = false where id = v_old.id;
  v_version := v_old.version + 1;
  insert into public.platform_settings (key, value, version, is_current, is_sample, description, updated_by)
    values (p_key, p_value, v_version, true, coalesce(p_is_sample, true), trim(p_description), auth.uid()) returning * into v_old;
  perform app_private.audit('setting.updated', 'platform_setting', p_key, jsonb_build_object('version', v_version, 'value', p_value));
  return jsonb_build_object('key', v_old.key, 'value', v_old.value, 'version', v_old.version, 'is_sample', v_old.is_sample, 'description', v_old.description);
end
$$;

create function public.list_audit_log(p_limit integer default 100) returns table (id bigint, action text, entity_type text, entity_id text, metadata jsonb, created_at timestamptz, actor_name text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at, p.full_name
    from public.audit_logs a left join public.profiles p on p.id = a.actor_id
   where app_private.is_staff() order by a.created_at desc limit least(greatest(coalesce(p_limit,100),1),200)
$$;

revoke all on function public.get_my_premium(), public.subscribe_premium_demo(text,text), public.cancel_premium(), public.set_featured_listing(uuid,boolean), public.get_lender_analytics(), public.update_platform_setting(text,jsonb,text,boolean), public.list_audit_log(integer) from public, anon;
grant execute on function public.get_my_premium(), public.subscribe_premium_demo(text,text), public.cancel_premium(), public.set_featured_listing(uuid,boolean), public.get_lender_analytics(), public.update_platform_setting(text,jsonb,text,boolean), public.list_audit_log(integer) to authenticated;
revoke execute on function app_private.expire_my_premium(uuid), app_private.require_premium(uuid) from public, authenticated;
