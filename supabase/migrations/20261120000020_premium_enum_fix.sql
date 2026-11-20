-- Correct the enum expressions in the Phase 12 subscription RPC without editing deployed migration 019.
create or replace function public.subscribe_premium_demo(p_idempotency_key text, p_scenario text default 'success') returns jsonb
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
    values (v_uid, (case when v_ok then 'active' else 'payment_failed' end)::public.subscription_status, v_price, case when v_ok then now() end, case when v_ok then now() + interval '1 month' end, null) returning * into s;
  insert into public.payments (purpose, subscription_id, payer_id, amount, provider, status, idempotency_key, provider_ref, failure_reason, processed_at)
    values ('subscription', s.id, v_uid, v_price, 'mock', (case when v_ok then 'succeeded' else 'failed' end)::public.payment_status, p_idempotency_key,
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
