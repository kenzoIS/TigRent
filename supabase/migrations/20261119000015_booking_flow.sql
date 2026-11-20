-- Phase 8: booking requests, lender decisions, atomic payment holds, demo checkout (plan §2.4, §2.5, Phase 8).
-- Every booking state change goes through these SECURITY DEFINER functions; the table stays read-only to clients.
-- No real money moves: the payment adapter is the mock provider (payments.provider = 'mock').

-- ── Shared helpers ─────────────────────────────────────────────────────────

-- Allowed booking transitions: the single server definition (mirrored and parity-tested in src/domain/bookings.ts).
create function app_private.booking_transition_allowed(p_from public.booking_status, p_to public.booking_status) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(case p_from
    when 'pending_lender_approval' then p_to in ('rejected', 'cancelled', 'awaiting_payment')
    when 'awaiting_payment' then p_to in ('confirmed', 'payment_expired', 'cancelled')
    when 'confirmed' then p_to in ('active', 'cancelled')
    when 'active' then p_to in ('return_requested', 'overdue', 'disputed')
    when 'overdue' then p_to in ('return_requested', 'disputed')
    when 'return_requested' then p_to in ('completed', 'disputed')
    when 'disputed' then p_to in ('completed', 'cancelled')
    else false
  end, false)
$$;

-- Validates a transition and appends it to the booking's history. Callers update the row themselves.
create function app_private.log_transition(p_booking public.bookings, p_to public.booking_status, p_actor uuid, p_reason text, p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.booking_transition_allowed(p_booking.status, p_to) then
    raise exception 'conflict.invalid_transition' using errcode = 'P0001',
      hint = 'This booking can’t move from ' || replace(p_booking.status::text, '_', ' ') || ' to ' || replace(p_to::text, '_', ' ') || '.';
  end if;
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, reason, metadata)
  values (p_booking.id, p_actor, p_booking.status, p_to, p_reason, coalesce(p_metadata, '{}'::jsonb));
end
$$;

-- Same pattern as src/domain/listings.ts PHONE_RE: keep contact details inside TigRent messages.
create function app_private.has_phone_number(p_text text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_text, '') ~ '(\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}|\m\d{3}[\s-]\d{4}\M'
$$;

create function app_private.peso(p_centavos bigint) returns text
language sql immutable set search_path = '' as $$
  select '₱' || to_char(p_centavos / 100.0, 'FM999,999,990.00')
$$;

create function app_private.short_dates(p_pickup date, p_return date) returns text
language sql immutable set search_path = '' as $$
  select case when p_pickup = p_return then to_char(p_pickup, 'Mon FMDD')
              else to_char(p_pickup, 'Mon FMDD') || '–' || to_char(p_return, 'Mon FMDD') end
$$;

-- Caller must be a verified, active student with the borrower role (new rentals only, plan §2.9).
create function app_private.require_active_borrower() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  if not app_private.has_role('borrower') then
    raise exception 'forbidden.not_borrower' using errcode = 'P0001', hint = 'Enable borrowing on your profile first.';
  end if;
  if app_private.verification_status(auth.uid()) <> 'verified' then
    raise exception 'forbidden.not_verified' using errcode = 'P0001', hint = 'Only verified students can rent equipment.';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and account_status <> 'active') then
    raise exception 'forbidden.account_restricted' using errcode = 'P0001',
      hint = 'New rentals are paused while your account is under review. Your existing bookings stay available.';
  end if;
end
$$;

-- Request-window rules shared by quote_booking and request_booking (one definition, plan §2.3).
create function app_private.check_request_window(v public.listings, p_pickup date, p_return date) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_max_days integer := coalesce((app_private.setting('max_rental_days'))::int, 30);
  v_max_ahead integer := coalesce((app_private.setting('max_advance_days'))::int, 90);
begin
  if v.id is null or v.status <> 'active' or v.moderation_status = 'hidden' then
    raise exception 'not_found.listing' using errcode = 'P0001', hint = 'This item isn’t available to rent right now.';
  end if;
  if v.lender_id = auth.uid() then
    raise exception 'forbidden.own_listing' using errcode = 'P0001', hint = 'You can’t rent your own listing.';
  end if;
  if p_pickup is null or p_return is null or p_return < p_pickup then
    raise exception 'validation.dates' using errcode = 'P0001', hint = 'The return date must be on or after the pickup date.';
  end if;
  if p_pickup < v_today then
    raise exception 'validation.pickup_past' using errcode = 'P0001', hint = 'Choose a pickup date from today onwards.';
  end if;
  if p_pickup > v_today + v_max_ahead then
    raise exception 'validation.pickup_too_far' using errcode = 'P0001', hint = 'Pickup can be at most ' || v_max_ahead || ' days ahead.';
  end if;
  if app_private.rental_days(p_pickup, p_return) > v_max_days then
    raise exception 'validation.too_long' using errcode = 'P0001', hint = 'A single rental can be at most ' || v_max_days || ' days.';
  end if;
end
$$;

-- quote_booking now shares the request-window rules (same signature and output as migration 014).
create or replace function public.quote_booking(p_listing_id uuid, p_pickup date, p_return date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.listings;
begin
  perform app_private.require_browser();
  select * into v from public.listings where id = p_listing_id;
  perform app_private.check_request_window(v, p_pickup, p_return);
  return app_private.price_quote(v, p_pickup, p_return) || jsonb_build_object(
    'available', app_private.listing_is_free(v.id, p_pickup, p_return),
    'max_rental_days', coalesce((app_private.setting('max_rental_days'))::int, 30),
    'policy_version', (select version from public.cancellation_policy_versions where is_active),
    'rental_terms_version_id', (select id from public.terms_versions where doc_type = 'rental_terms' and is_active));
end
$$;

-- Releases one lapsed payment hold (server time decides, plan §10.1). Caller holds the row lock.
create function app_private.expire_hold(b public.bookings) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_title text := coalesce(b.snapshot ->> 'listing_title', 'your rental');
begin
  perform app_private.log_transition(b, 'payment_expired', null, 'The demo payment window closed before checkout.',
    jsonb_build_object('hold_expires_at', b.hold_expires_at));
  update public.bookings set status = 'payment_expired' where id = b.id;
  -- Audit record of the lapsed attempt. No ledger entries: no simulated money moved.
  insert into public.payments (purpose, booking_id, payer_id, amount, status, idempotency_key, failure_reason, processed_at)
  values ('booking', b.id, b.borrower_id, b.total, 'expired', 'expire:' || b.id, 'Payment window closed before checkout (simulated).', now())
  on conflict (idempotency_key) do nothing;
  perform app_private.notify(b.borrower_id, 'booking.payment_expired', 'Payment window closed',
    'The hold on ' || v_title || ' (' || app_private.short_dates(b.pickup_date, b.return_date) || ') expired before payment, so the dates were released. You can send a new request.',
    'booking', b.id, 'booking:' || b.id || ':payment_expired:borrower');
  perform app_private.notify(b.lender_id, 'booking.payment_expired', 'Hold expired',
    'The borrower didn’t pay for ' || v_title || ' in time, so ' || app_private.short_dates(b.pickup_date, b.return_date) || ' is free again.',
    'booking', b.id, 'booking:' || b.id || ':payment_expired:lender');
end
$$;

-- Lazy expiry sweep: any lapsed hold (optionally for one listing) becomes payment_expired.
-- SKIP LOCKED: a booking mid-checkout is decided by that checkout, never by the sweep.
create function app_private.expire_stale_holds(p_listing uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  n integer := 0;
begin
  for b in
    select * from public.bookings
     where status = 'awaiting_payment' and hold_expires_at <= now() and (p_listing is null or listing_id = p_listing)
     order by hold_expires_at
     for update skip locked
  loop
    perform app_private.expire_hold(b);
    n := n + 1;
  end loop;
  return n;
end
$$;

-- Why a pending request can't be accepted right now (lender conflict explanation, plan §4.3).
create function app_private.request_conflict(b public.bookings) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when b.status <> 'pending_lender_approval' then null
    when exists (select 1 from public.listings l where l.id = b.listing_id and (l.status = 'removed' or l.moderation_status = 'hidden')) then 'listing_unavailable'
    when b.pickup_date < (now() at time zone 'Asia/Manila')::date then 'pickup_passed'
    when exists (
      select 1 from public.bookings o
       where o.listing_id = b.listing_id and o.id <> b.id
         and o.status in ('awaiting_payment', 'confirmed', 'active', 'overdue', 'return_requested', 'disputed')
         and (o.status <> 'awaiting_payment' or o.hold_expires_at > now())
         and daterange(o.pickup_date, o.return_date, '[]') && daterange(b.pickup_date, b.return_date, '[]')) then 'dates_taken'
    when exists (
      select 1 from public.listing_availability a
       where a.listing_id = b.listing_id and daterange(a.start_date, a.end_date, '[]') && daterange(b.pickup_date, b.return_date, '[]')) then 'dates_blocked'
    else null
  end
$$;

-- ── Booking request (Journey C.6) ──────────────────────────────────────────
create function public.request_booking(
  p_listing_id uuid,
  p_pickup date,
  p_return date,
  p_terms_version_id uuid,
  p_expected_total bigint default null,
  p_pickup_arrangement text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v public.listings;
  v_terms public.terms_versions;
  v_policy public.cancellation_policy_versions;
  v_quote jsonb;
  v_note text := nullif(trim(coalesce(p_pickup_arrangement, '')), '');
  v_existing uuid;
  v_id uuid;
  v_name text;
begin
  perform app_private.require_active_borrower();
  -- Row lock: double taps and concurrent requests by one borrower for one item serialize here.
  select * into v from public.listings where id = p_listing_id for update;
  perform app_private.check_request_window(v, p_pickup, p_return);

  -- Idempotent resend (double tap / retry): an identical open request is returned, not duplicated.
  select id into v_existing from public.bookings
   where listing_id = v.id and borrower_id = v_me and pickup_date = p_pickup and return_date = p_return
     and status in ('pending_lender_approval', 'awaiting_payment', 'confirmed')
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;
  if exists (
    select 1 from public.bookings
     where listing_id = v.id and borrower_id = v_me
       and status in ('pending_lender_approval', 'awaiting_payment', 'confirmed', 'active', 'overdue', 'return_requested', 'disputed')
       and (status <> 'awaiting_payment' or hold_expires_at > now())
       and daterange(pickup_date, return_date, '[]') && daterange(p_pickup, p_return, '[]')) then
    raise exception 'conflict.duplicate_request' using errcode = 'P0001',
      hint = 'You already have a request or booking for this item on overlapping dates. Check My Rentals.';
  end if;
  if not app_private.listing_is_free(v.id, p_pickup, p_return) then
    raise exception 'conflict.dates_unavailable' using errcode = 'P0001',
      hint = 'Some of these dates were just booked or blocked by the lender. Choose other dates.';
  end if;

  select * into v_terms from public.terms_versions where doc_type = 'rental_terms' and is_active;
  select * into v_policy from public.cancellation_policy_versions where is_active;
  if v_terms.id is null or v_policy.id is null then
    raise exception 'conflict.no_active_terms' using errcode = 'P0001', hint = 'Booking is paused while TigRent updates its rental terms. Try again later.';
  end if;
  if p_terms_version_id is distinct from v_terms.id then
    raise exception 'conflict.terms_changed' using errcode = 'P0001', hint = 'The rental terms were updated. Review the new terms and send again.';
  end if;

  v_quote := app_private.price_quote(v, p_pickup, p_return);
  if p_expected_total is not null and p_expected_total <> (v_quote ->> 'total')::bigint then
    raise exception 'conflict.price_changed' using errcode = 'P0001', hint = 'The price changed while you were reviewing. Check the new total and send again.';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'validation.pickup_arrangement' using errcode = 'P0001', hint = 'Keep the pickup note under 300 characters.';
  end if;
  if app_private.has_phone_number(v_note) then
    raise exception 'validation.contact_details' using errcode = 'P0001', hint = 'Don’t put phone numbers here. Use TigRent messages to coordinate.';
  end if;

  insert into public.bookings (listing_id, borrower_id, lender_id, pickup_date, return_date, rental_days, due_at, pickup_arrangement,
    status, snapshot, daily_rate, late_fee_per_day, commission_bps, subtotal, deposit, total, commission, lender_net,
    policy_version_id, terms_version_id)
  values (v.id, v_me, v.lender_id, p_pickup, p_return, (v_quote ->> 'rental_days')::int, (v_quote ->> 'due_at')::timestamptz, v_note,
    'pending_lender_approval',
    -- Immutable agreement snapshot: later listing or policy edits never rewrite it (plan §2.4, §10.1).
    jsonb_build_object(
      'listing_title', v.title, 'description', v.description, 'category', v.category,
      'category_label', (select label from public.listing_categories where slug = v.category),
      'condition', v.condition, 'equipment_notes', v.equipment_notes,
      'daily_rate', v.daily_rate, 'deposit', v.deposit, 'late_fee_per_day', v.late_fee_per_day,
      'pickup_point', (select label from public.campus_pickup_points where id = v.pickup_point_id), 'pickup_notes', v.pickup_notes,
      'cover_path', (select i.path from public.listing_images i where i.listing_id = v.id order by i.sort_order limit 1),
      'commission_bps', (v_quote ->> 'commission_bps')::int, 'return_due_time_local', v_quote ->> 'return_due_time_local',
      'policy_version', v_policy.version, 'policy_label', v_policy.label, 'policy_is_sample', v_policy.is_sample,
      'rental_terms_version', v_terms.version, 'rental_terms_title', v_terms.title, 'quoted_at', now()),
    (v_quote ->> 'daily_rate')::bigint, (v_quote ->> 'late_fee_per_day')::bigint, (v_quote ->> 'commission_bps')::int,
    (v_quote ->> 'subtotal')::bigint, (v_quote ->> 'deposit')::bigint, (v_quote ->> 'total')::bigint,
    (v_quote ->> 'commission')::bigint, (v_quote ->> 'lender_net')::bigint, v_policy.id, v_terms.id)
  returning id into v_id;

  insert into public.booking_terms_acceptances (booking_id, user_id, terms_version_id, terms_snapshot)
  values (v_id, v_me, v_terms.id, jsonb_build_object(
    'terms_version_id', v_terms.id, 'version', v_terms.version, 'title', v_terms.title, 'content', v_terms.content, 'is_sample', v_terms.is_sample,
    'policy_version', v_policy.version, 'accepted_total', (v_quote ->> 'total')::bigint));
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, reason, metadata)
  values (v_id, v_me, null, 'pending_lender_approval', 'Borrower sent a request',
          jsonb_build_object('total', (v_quote ->> 'total')::bigint, 'rental_days', (v_quote ->> 'rental_days')::int));

  select full_name into v_name from public.profiles where id = v_me;
  perform app_private.notify(v.lender_id, 'booking.requested', 'New booking request',
    coalesce(split_part(v_name, ' ', 1), 'A student') || ' wants ' || v.title || ' for ' || app_private.short_dates(p_pickup, p_return)
      || ' (' || (v_quote ->> 'rental_days') || ' day' || case when (v_quote ->> 'rental_days')::int = 1 then '' else 's' end || ', '
      || app_private.peso((v_quote ->> 'subtotal')::bigint) || ' rent). Accept or decline it in Requests.',
    'booking', v_id, 'booking:' || v_id || ':requested:lender');
  perform app_private.notify(v_me, 'booking.request_sent', 'Request sent',
    'Your request for ' || v.title || ' (' || app_private.short_dates(p_pickup, p_return) || ') is with the lender. Nothing has been charged.',
    'booking', v_id, 'booking:' || v_id || ':requested:borrower');
  return v_id;
end
$$;

-- ── Lender decision: reject with a reason, or accept into a payment hold (plan §2.4) ──
create function public.decide_booking_request(p_booking_id uuid, p_decision text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v public.listings;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_title text;
  v_minutes integer := greatest(1, coalesce((app_private.setting('payment_hold_minutes'))::int, 15));
  v_hold timestamptz;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  if p_decision is null or p_decision not in ('accept', 'reject') then
    raise exception 'validation.decision' using errcode = 'P0001', hint = 'Choose accept or decline.';
  end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.lender_id <> auth.uid() then
    raise exception 'not_found.booking' using errcode = 'P0001', hint = 'This request isn’t for one of your listings, or it no longer exists.';
  end if;
  v_title := coalesce(b.snapshot ->> 'listing_title', 'your item');

  -- The same decision repeated (double tap, retry) returns the first result.
  if (p_decision = 'accept' and b.status = 'awaiting_payment') or (p_decision = 'reject' and b.status = 'rejected') then
    return jsonb_build_object('status', b.status, 'hold_expires_at', b.hold_expires_at, 'repeated', true);
  end if;
  if b.status <> 'pending_lender_approval' then
    raise exception 'conflict.already_decided' using errcode = 'P0001',
      hint = 'This request was already handled (' || replace(b.status::text, '_', ' ') || ').';
  end if;

  if p_decision = 'reject' then
    if v_reason is null or char_length(v_reason) not between 3 and 300 then
      raise exception 'validation.reason' using errcode = 'P0001', hint = 'Give the borrower a short reason (3 to 300 characters).';
    end if;
    perform app_private.log_transition(b, 'rejected', auth.uid(), v_reason);
    update public.bookings set status = 'rejected', decision_reason = v_reason, decided_at = now() where id = b.id;
    perform app_private.notify(b.borrower_id, 'booking.rejected', 'Request declined',
      'The lender declined your request for ' || v_title || ' (' || app_private.short_dates(b.pickup_date, b.return_date) || '): “' || v_reason || '” Nothing was charged.',
      'booking', b.id, 'booking:' || b.id || ':rejected:borrower');
    perform app_private.notify(b.lender_id, 'booking.rejected', 'Request declined',
      'You declined the request for ' || v_title || ' (' || app_private.short_dates(b.pickup_date, b.return_date) || ').',
      'booking', b.id, 'booking:' || b.id || ':rejected:lender');
    return jsonb_build_object('status', 'rejected', 'hold_expires_at', null, 'repeated', false);
  end if;

  -- Accept: only an active, verified lender can create new holds.
  perform app_private.require_active_lender();
  -- Row lock on the listing serializes concurrent acceptances for one item (plan §2.4, §6.4);
  -- the bookings_no_overlap exclusion constraint is the final backstop.
  select * into v from public.listings where id = b.listing_id for update;
  perform app_private.expire_stale_holds(b.listing_id);
  case app_private.request_conflict(b)
    when 'listing_unavailable' then
      raise exception 'conflict.listing_unavailable' using errcode = 'P0001', hint = 'This listing was removed or hidden, so it can’t be booked. Decline the request.';
    when 'pickup_passed' then
      raise exception 'conflict.pickup_passed' using errcode = 'P0001', hint = 'The pickup date has passed. Decline this request; the borrower can send new dates.';
    when 'dates_taken' then
      raise exception 'conflict.dates_taken' using errcode = 'P0001', hint = 'These dates are no longer available: another booking already holds them. Decline this request or ask the borrower for other dates.';
    when 'dates_blocked' then
      raise exception 'conflict.dates_blocked' using errcode = 'P0001', hint = 'You blocked some of these dates in your calendar. Remove the block first, or decline.';
    else null;
  end case;

  v_hold := now() + make_interval(mins => v_minutes);
  begin
    update public.bookings set status = 'awaiting_payment', hold_expires_at = v_hold, decided_at = now(), decision_reason = v_reason where id = b.id;
  exception when exclusion_violation then
    raise exception 'conflict.dates_taken' using errcode = 'P0001', hint = 'These dates are no longer available: another booking already holds them. Decline this request or ask the borrower for other dates.';
  end;
  perform app_private.log_transition(b, 'awaiting_payment', auth.uid(), coalesce(v_reason, 'Lender accepted'),
    jsonb_build_object('hold_expires_at', v_hold, 'hold_minutes', v_minutes));
  perform app_private.notify(b.borrower_id, 'booking.accepted', 'Request accepted: complete the demo payment',
    'The lender accepted ' || v_title || ' (' || app_private.short_dates(b.pickup_date, b.return_date) || '). Pay ' || app_private.peso(b.total)
      || ' within ' || v_minutes || ' minutes to confirm, or the dates are released.',
    'booking', b.id, 'booking:' || b.id || ':accepted:borrower');
  perform app_private.notify(b.lender_id, 'booking.accepted', 'Waiting for payment',
    'You accepted ' || v_title || ' (' || app_private.short_dates(b.pickup_date, b.return_date) || '). The dates are held for '
      || v_minutes || ' minutes while the borrower pays.',
    'booking', b.id, 'booking:' || b.id || ':accepted:lender');
  return jsonb_build_object('status', 'awaiting_payment', 'hold_expires_at', v_hold, 'hold_minutes', v_minutes, 'repeated', false);
end
$$;

-- ── Demo checkout (mock payment provider, plan §2.5) ───────────────────────
create function app_private.payment_result(p public.payments, p_replayed boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'payment_id', p.id,
    'outcome', case p.status when 'succeeded' then 'success' when 'failed' then 'failure' when 'expired' then 'expired' else 'pending' end,
    'amount', p.amount, 'provider', p.provider, 'provider_ref', p.provider_ref, 'failure_reason', p.failure_reason,
    'processed_at', p.processed_at, 'replayed', p_replayed,
    'booking_status', (select status from public.bookings where id = p.booking_id))
$$;

create function public.pay_booking_demo(p_booking_id uuid, p_idempotency_key text, p_scenario text default 'success') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  p public.payments;
  v_mode text := coalesce(app_private.setting('payment_provider_mode') #>> '{}', 'mock_user_choice');
  v_outcome text;
  v_title text;
  v_bps_label text;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'validation.idempotency_key' using errcode = 'P0001', hint = 'Checkout couldn’t start. Go back and try again.';
  end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.borrower_id <> auth.uid() then
    raise exception 'not_found.booking' using errcode = 'P0001', hint = 'Only the borrower can pay for this booking.';
  end if;
  -- Replay (checked after taking the row lock, so concurrent double taps see the first result).
  select * into p from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if p.payer_id <> auth.uid() or p.booking_id is distinct from b.id then
      raise exception 'conflict.idempotency_key' using errcode = 'P0001', hint = 'Checkout couldn’t start. Go back and try again.';
    end if;
    return app_private.payment_result(p, true);
  end if;
  -- Already paid with another attempt: never charge twice.
  if b.status in ('confirmed', 'active', 'overdue', 'return_requested', 'disputed', 'completed') then
    select * into p from public.payments where booking_id = b.id and purpose = 'booking' and status = 'succeeded' limit 1;
    if found then
      return app_private.payment_result(p, true);
    end if;
  end if;
  -- Hold lapsed (server time): release it now. Returned, not raised, so the release is kept.
  if b.status = 'awaiting_payment' and b.hold_expires_at <= now() then
    perform app_private.expire_hold(b);
    select * into p from public.payments where idempotency_key = 'expire:' || b.id;
    return app_private.payment_result(p, false);
  end if;
  if b.status <> 'awaiting_payment' then
    raise exception 'conflict.not_payable' using errcode = 'P0001',
      hint = 'This booking isn’t waiting for payment (' || replace(b.status::text, '_', ' ') || ').';
  end if;

  v_outcome := case v_mode when 'mock_always_succeed' then 'success' when 'mock_always_fail' then 'failure' else p_scenario end;
  if v_outcome is null or v_outcome not in ('success', 'failure') then
    raise exception 'validation.scenario' using errcode = 'P0001', hint = 'Choose a demo payment outcome.';
  end if;
  v_title := coalesce(b.snapshot ->> 'listing_title', 'your rental');

  if v_outcome = 'success' then
    insert into public.payments (purpose, booking_id, payer_id, amount, status, idempotency_key, provider_ref, processed_at)
    values ('booking', b.id, b.borrower_id, b.total, 'succeeded', p_idempotency_key,
            'MOCK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), now())
    returning * into p;
    -- Balanced simulated ledger (debits = credits). Keys are per booking, so a booking is booked once.
    v_bps_label := trim(trailing '.' from to_char(b.commission_bps / 100.0, 'FM990.99'));
    insert into public.ledger_entries (booking_id, payment_id, party_id, category, debit, credit, description, idempotency_key) values
      (b.id, p.id, b.borrower_id, 'borrower_payment', b.total, 0, 'Simulated borrower payment', 'booking:' || b.id || ':paid:borrower_payment'),
      (b.id, p.id, b.lender_id, 'rent_payable', 0, b.lender_net, 'Simulated lender payable (not paid out)', 'booking:' || b.id || ':paid:rent_payable');
    if b.commission > 0 then
      insert into public.ledger_entries (booking_id, payment_id, party_id, category, debit, credit, description, idempotency_key)
      values (b.id, p.id, null, 'platform_commission', 0, b.commission, 'Platform commission (' || v_bps_label || '%)', 'booking:' || b.id || ':paid:platform_commission');
    end if;
    if b.deposit > 0 then
      insert into public.ledger_entries (booking_id, payment_id, party_id, category, debit, credit, description, idempotency_key)
      values (b.id, p.id, b.borrower_id, 'deposit_held', 0, b.deposit, 'Refundable deposit held (not revenue)', 'booking:' || b.id || ':paid:deposit_held');
    end if;
    perform app_private.log_transition(b, 'confirmed', auth.uid(), 'Demo payment succeeded', jsonb_build_object('payment_id', p.id));
    update public.bookings set status = 'confirmed' where id = b.id;
    perform app_private.notify(b.borrower_id, 'booking.paid', 'Booking confirmed',
      'Demo payment of ' || app_private.peso(b.total) || ' succeeded. ' || v_title || ' is yours for ' || app_private.short_dates(b.pickup_date, b.return_date) || '. No real money moved.',
      'booking', b.id, 'booking:' || b.id || ':paid:borrower');
    perform app_private.notify(b.lender_id, 'booking.paid', 'Booking confirmed',
      'The borrower paid for ' || v_title || ' (' || app_private.short_dates(b.pickup_date, b.return_date) || '). Your estimated share is '
        || app_private.peso(b.lender_net) || ' after commission (simulated, not paid out).',
      'booking', b.id, 'booking:' || b.id || ':paid:lender');
  else
    insert into public.payments (purpose, booking_id, payer_id, amount, status, idempotency_key, provider_ref, failure_reason, processed_at)
    values ('booking', b.id, b.borrower_id, b.total, 'failed', p_idempotency_key,
            'MOCK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), 'Demo payment declined (simulated failure). No money moved.', now())
    returning * into p;
    -- A failed payment releases the hold (plan §2.4). No ledger entries: nothing was collected.
    perform app_private.log_transition(b, 'cancelled', null, 'Demo payment failed; the hold was released.',
      jsonb_build_object('payment_id', p.id, 'cause', 'payment_failed'));
    update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Demo payment failed, so the hold was released.' where id = b.id;
    perform app_private.notify(b.borrower_id, 'booking.payment_failed', 'Payment failed',
      'The demo payment for ' || v_title || ' was declined, so the hold was released. Nothing was charged. You can send a new request.',
      'booking', b.id, 'booking:' || b.id || ':payment_failed:borrower');
    perform app_private.notify(b.lender_id, 'booking.payment_failed', 'Payment failed',
      'The borrower’s demo payment for ' || v_title || ' failed, so ' || app_private.short_dates(b.pickup_date, b.return_date) || ' is free again.',
      'booking', b.id, 'booking:' || b.id || ':payment_failed:lender');
  end if;
  return app_private.payment_result(p, false);
end
$$;

-- ── Reads ──────────────────────────────────────────────────────────────────

-- Any signed-in client may trigger the (idempotent, server-timed) expiry sweep before reading bookings.
create function public.sweep_expired_holds() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  return app_private.expire_stale_holds(null);
end
$$;

-- Full booking view for its two parties (and staff): agreement, money, history, receipts, conflicts.
create function public.get_booking_detail(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  b public.bookings;
  v_role text;
  v_other uuid;
  v_other_rating record;
begin
  if v_me is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  select * into b from public.bookings where id = p_booking_id;
  if not found or not (v_me in (b.borrower_id, b.lender_id) or app_private.is_staff()) then
    raise exception 'not_found.booking' using errcode = 'P0001', hint = 'This booking isn’t yours or no longer exists.';
  end if;
  v_role := case when v_me = b.borrower_id then 'borrower' when v_me = b.lender_id then 'lender' else 'staff' end;
  v_other := case when v_role = 'lender' then b.borrower_id else b.lender_id end;
  if v_role = 'lender' then
    select round(avg(rating)::numeric, 2) as avg, count(*)::int as count into v_other_rating
      from public.reviews where target_id = v_other and direction = 'lender_to_borrower' and moderation_status = 'visible';
  else
    select avg, count into v_other_rating from app_private.lender_rating(v_other);
  end if;

  return jsonb_build_object(
    'id', b.id, 'my_role', v_role, 'status', b.status, 'listing_id', b.listing_id,
    'listing_status', (select status from public.listings where id = b.listing_id),
    'pickup_date', b.pickup_date, 'return_date', b.return_date, 'rental_days', b.rental_days, 'due_at', b.due_at,
    'pickup_arrangement', b.pickup_arrangement, 'snapshot', b.snapshot,
    'daily_rate', b.daily_rate, 'subtotal', b.subtotal, 'deposit', b.deposit, 'total', b.total, 'late_fee_per_day', b.late_fee_per_day,
    'commission_bps', b.commission_bps, 'commission', b.commission, 'lender_net', b.lender_net,
    'hold_expires_at', b.hold_expires_at, 'server_now', now(),
    'decision_reason', b.decision_reason, 'decided_at', b.decided_at, 'cancel_reason', b.cancel_reason, 'cancelled_at', b.cancelled_at,
    'created_at', b.created_at,
    'conflict', case when v_role in ('lender', 'staff') then app_private.request_conflict(b) end,
    'counterpart', jsonb_build_object(
      'id', v_other, 'role', case when v_role = 'lender' then 'borrower' else 'lender' end,
      'full_name', (select full_name from public.profiles where id = v_other),
      'is_student_verified', app_private.verification_status(v_other) = 'verified',
      'rating_avg', v_other_rating.avg, 'rating_count', coalesce(v_other_rating.count, 0)),
    -- Terms versions are immutable rows, so the referenced version is the accepted text.
    'terms', (select jsonb_build_object('title', tv.title, 'version', tv.version, 'is_sample', tv.is_sample, 'accepted_at', t.accepted_at)
                from public.booking_terms_acceptances t join public.terms_versions tv on tv.id = t.terms_version_id
               where t.booking_id = b.id and t.user_id = b.borrower_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('from_status', e.from_status, 'to_status', e.to_status, 'reason', e.reason,
                                                            'by_me', e.actor_id = v_me, 'at', e.created_at) order by e.created_at, e.id)
                          from public.booking_events e where e.booking_id = b.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'status', p.status, 'amount', p.amount, 'provider', p.provider,
                                                              'provider_ref', p.provider_ref, 'failure_reason', p.failure_reason,
                                                              'processed_at', p.processed_at, 'created_at', p.created_at) order by p.created_at)
                            from public.payments p where p.booking_id = b.id and p.purpose = 'booking'), '[]'::jsonb));
end
$$;

-- Lender inbox: open requests with conflict flags, holds awaiting payment, and recent decisions.
create function public.list_booking_requests() returns table (
  id uuid, listing_id uuid, listing_title text, cover_path text, borrower_id uuid, borrower_name text,
  pickup_date date, return_date date, rental_days integer, subtotal bigint, lender_net bigint, status public.booking_status,
  hold_expires_at timestamptz, created_at timestamptz, decided_at timestamptz, conflict text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  return query
    select b.id, b.listing_id, coalesce(b.snapshot ->> 'listing_title', ''), b.snapshot ->> 'cover_path', b.borrower_id, p.full_name,
           b.pickup_date, b.return_date, b.rental_days, b.subtotal, b.lender_net, b.status,
           b.hold_expires_at, b.created_at, b.decided_at, app_private.request_conflict(b)
      from public.bookings b
      join public.profiles p on p.id = b.borrower_id
     where b.lender_id = auth.uid()
       and (b.status in ('pending_lender_approval', 'awaiting_payment')
            or (b.status in ('rejected', 'payment_expired', 'cancelled', 'confirmed') and coalesce(b.decided_at, b.created_at) > now() - interval '30 days'))
     order by case b.status when 'pending_lender_approval' then 0 when 'awaiting_payment' then 1 else 2 end,
              case when b.status = 'pending_lender_approval' then b.created_at end asc,
              coalesce(b.decided_at, b.created_at) desc
     limit 100;
end
$$;

-- ── Close the client-only gap: listing notes reject phone numbers server-side too ──
create or replace function app_private.validate_listing_fields(f jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare
  v_title text := trim(coalesce(f ->> 'title', ''));
  v_desc text := coalesce(f ->> 'description', '');
begin
  if char_length(v_title) not between 3 and 80 then
    raise exception 'validation.title' using errcode = 'P0001', hint = 'Use a title of 3 to 80 characters.';
  end if;
  if char_length(v_desc) > 2000 then
    raise exception 'validation.description' using errcode = 'P0001', hint = 'Keep the description under 2,000 characters.';
  end if;
  if not exists (select 1 from public.listing_categories where slug = f ->> 'category' and is_active) then
    raise exception 'validation.category' using errcode = 'P0001', hint = 'Choose a category.';
  end if;
  if (f ->> 'condition') is null or (f ->> 'condition') not in ('new', 'like_new', 'good', 'fair', 'worn') then
    raise exception 'validation.condition' using errcode = 'P0001', hint = 'Choose the item’s condition.';
  end if;
  if (f ->> 'daily_rate') is null or (f ->> 'daily_rate') !~ '^\d+$' or (f ->> 'daily_rate')::bigint > 10000000 then
    raise exception 'validation.daily_rate' using errcode = 'P0001', hint = 'Enter a daily rate in pesos (up to ₱100,000).';
  end if;
  if coalesce(f ->> 'deposit', '0') !~ '^\d+$' or coalesce(f ->> 'deposit', '0')::bigint > 100000000 then
    raise exception 'validation.deposit' using errcode = 'P0001', hint = 'Enter a deposit of ₱0 or more (up to ₱1,000,000).';
  end if;
  if coalesce(f ->> 'late_fee_per_day', '0') !~ '^\d+$' or coalesce(f ->> 'late_fee_per_day', '0')::bigint > 10000000 then
    raise exception 'validation.late_fee_per_day' using errcode = 'P0001', hint = 'Enter a late fee of ₱0 or more per day.';
  end if;
  if (f ->> 'pickup_point_id') is not null
     and not exists (select 1 from public.campus_pickup_points where id = (f ->> 'pickup_point_id')::uuid and is_active) then
    raise exception 'validation.pickup_point_id' using errcode = 'P0001', hint = 'Choose an approved pickup point.';
  end if;
  if char_length(coalesce(f ->> 'pickup_notes', '')) > 500 or char_length(coalesce(f ->> 'equipment_notes', '')) > 500 then
    raise exception 'validation.notes' using errcode = 'P0001', hint = 'Keep notes under 500 characters.';
  end if;
  if app_private.has_phone_number(f ->> 'pickup_notes') then
    raise exception 'validation.pickup_notes' using errcode = 'P0001', hint = 'Don’t put phone numbers here. Use TigRent messages to coordinate.';
  end if;
end
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────
revoke all on function
  public.request_booking(uuid, date, date, uuid, bigint, text),
  public.decide_booking_request(uuid, text, text),
  public.pay_booking_demo(uuid, text, text),
  public.sweep_expired_holds(),
  public.get_booking_detail(uuid),
  public.list_booking_requests()
from public, anon;
grant execute on function
  public.request_booking(uuid, date, date, uuid, bigint, text),
  public.decide_booking_request(uuid, text, text),
  public.pay_booking_demo(uuid, text, text),
  public.sweep_expired_holds(),
  public.get_booking_detail(uuid),
  public.list_booking_requests()
to authenticated;
revoke execute on function
  app_private.booking_transition_allowed(public.booking_status, public.booking_status),
  app_private.log_transition(public.bookings, public.booking_status, uuid, text, jsonb),
  app_private.has_phone_number(text),
  app_private.peso(bigint),
  app_private.short_dates(date, date),
  app_private.require_active_borrower(),
  app_private.check_request_window(public.listings, date, date),
  app_private.expire_hold(public.bookings),
  app_private.expire_stale_holds(uuid),
  app_private.request_conflict(public.bookings),
  app_private.payment_result(public.payments, boolean)
from public, authenticated;
