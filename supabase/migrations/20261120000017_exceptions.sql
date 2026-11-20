-- Phase 10: cancellations with policy-based refund previews, late fees, deposit withholding/release,
-- damage / missing-item disputes with private evidence, moderator resolution and appeals
-- (plan §2.5, §2.6, §2.7, Phase 10). All money is simulated; every movement is a refund row and/or
-- balanced, idempotent ledger lines.

insert into public.platform_settings (key, value, version, is_current, is_sample, description) values
  ('dispute_appeal_days', '7', 1, true, true, 'Days after a dispute decision during which either party may appeal (sample).')
on conflict (key, version) do nothing;

-- ── Money helpers ──────────────────────────────────────────────────────────

-- Percentage of an amount in centavos, half-up (same rounding as commission).
create function app_private.pct(p_amount bigint, p_pct numeric) returns bigint
language sql immutable set search_path = '' as $$
  select floor((p_amount * p_pct + 50) / 100)::bigint
$$;

-- One idempotent ledger line; zero amounts are skipped (a line must move money).
create function app_private.post_ledger(p_booking uuid, p_payment uuid, p_refund uuid, p_party uuid, p_category public.ledger_category,
                                        p_debit bigint, p_credit bigint, p_desc text, p_key text)
returns void language sql security definer set search_path = '' as $$
  insert into public.ledger_entries (booking_id, payment_id, refund_id, party_id, category, debit, credit, description, idempotency_key)
  select p_booking, p_payment, p_refund, p_party, p_category, greatest(p_debit, 0), greatest(p_credit, 0), p_desc, p_key
   where greatest(p_debit, 0) + greatest(p_credit, 0) > 0
  on conflict (idempotency_key) do nothing
$$;

create function app_private.booking_payment(p_booking uuid) returns public.payments
language sql stable security definer set search_path = '' as $$
  select * from public.payments where booking_id = p_booking and purpose = 'booking' and status = 'succeeded' limit 1
$$;

/*
 * The single settlement path for a paid booking's money (cancellations, late fees, dispute decisions):
 *   • p_rent_refund of the rent goes back to the borrower; the lender's payable and the platform
 *     commission are re-based on the rent that is kept (commission stays 10% of retained rent);
 *   • p_deposit_to_lender of the deposit is withheld for the lender under p_category
 *     (late_fee / damage_compensation / cancellation_adjustment), with commission only where the
 *     sample settings say it applies; the rest of the deposit is released.
 * The refund is one record linked to the booking payment (never overwriting it). Keys make it idempotent.
 */
create function app_private.settle_booking_money(b public.bookings, p_rent_refund bigint, p_deposit_to_lender bigint,
                                                 p_category public.ledger_category, p_key text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p public.payments := app_private.booking_payment(b.id);
  v_release bigint := b.deposit - p_deposit_to_lender;
  v_refund_total bigint := p_rent_refund + (b.deposit - p_deposit_to_lender);
  v_refund uuid;
  v_kept bigint;
  v_comm_after bigint;
  v_comm_w bigint := 0;
begin
  if p.id is null then
    return null; -- nothing was paid, nothing to settle
  end if;
  if p_rent_refund < 0 or p_rent_refund > b.subtotal or p_deposit_to_lender < 0 or p_deposit_to_lender > b.deposit
     or v_refund_total > p.amount then
    raise exception 'validation.amounts' using errcode = 'P0001', hint = 'Those amounts are outside what was paid for this booking.';
  end if;
  if v_refund_total > 0 then
    insert into public.refunds (payment_id, booking_id, amount, reason, status, idempotency_key, processed_at)
    values (p.id, b.id, v_refund_total, left(p_reason, 300), 'succeeded', p_key || ':refund', now())
    on conflict (idempotency_key) do nothing
    returning id into v_refund;
    if v_refund is null then
      return (select id from public.refunds where idempotency_key = p_key || ':refund'); -- already settled
    end if;
  end if;

  -- Deposit released to the borrower.
  perform app_private.post_ledger(b.id, null, v_refund, b.borrower_id, 'deposit_released', v_release, 0, 'Deposit released to borrower', p_key || ':deposit_released');
  perform app_private.post_ledger(b.id, null, v_refund, b.borrower_id, 'refund', 0, v_release, 'Simulated refund of deposit', p_key || ':deposit_refund');

  -- Deposit withheld for the lender (recorded reason; never platform revenue unless commission applies).
  if p_deposit_to_lender > 0 then
    if (p_category = 'late_fee' and coalesce((app_private.setting('commission_on_late_fees'))::boolean, false))
       or (p_category = 'damage_compensation' and coalesce((app_private.setting('commission_on_damage'))::boolean, false)) then
      v_comm_w := app_private.commission_amount(p_deposit_to_lender, b.commission_bps);
    end if;
    perform app_private.post_ledger(b.id, p.id, null, b.borrower_id, 'deposit_withheld', p_deposit_to_lender, 0, 'Deposit withheld: ' || left(p_reason, 120), p_key || ':deposit_withheld');
    perform app_private.post_ledger(b.id, p.id, null, b.lender_id, p_category, 0, p_deposit_to_lender - v_comm_w, 'Simulated payable to lender: ' || left(p_reason, 120), p_key || ':to_lender');
    perform app_private.post_ledger(b.id, p.id, null, null, 'platform_commission', 0, v_comm_w, 'Platform commission on ' || replace(p_category::text, '_', ' '), p_key || ':withheld_commission');
  end if;

  -- Rent refund: re-base the lender payable and commission on the rent that is kept.
  if p_rent_refund > 0 then
    v_kept := b.subtotal - p_rent_refund;
    v_comm_after := app_private.commission_amount(v_kept, b.commission_bps);
    perform app_private.post_ledger(b.id, null, v_refund, b.lender_id, 'cancellation_adjustment', b.lender_net - (v_kept - v_comm_after), 0, 'Lender payable reduced by rent refund', p_key || ':lender_adjustment');
    perform app_private.post_ledger(b.id, null, v_refund, null, 'cancellation_adjustment', b.commission - v_comm_after, 0, 'Platform commission reduced by rent refund', p_key || ':commission_adjustment');
    perform app_private.post_ledger(b.id, null, v_refund, b.borrower_id, 'refund', 0, p_rent_refund, 'Simulated refund of rent', p_key || ':rent_refund');
  end if;
  return v_refund;
end
$$;

-- ── Cancellation policy engine (plan §2.6) ─────────────────────────────────
-- Uses the policy version stored on the booking, so later policy edits never change an existing booking.
create function app_private.cancellation_quote(b public.bookings, p_side text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_policy public.cancellation_policy_versions;
  v_rules jsonb;
  v_paid public.payments := app_private.booking_payment(b.id);
  v_rule text;
  v_rent_pct numeric := 100;
  v_dep_pct numeric := 100;
  v_hours numeric := extract(epoch from (app_private.manila_timestamp(b.pickup_date, '00:00') - now())) / 3600.0;
  v_rent_refund bigint := 0;
  v_dep_refund bigint := 0;
  v_kept bigint;
  v_comm_after bigint;
  v_note text;
begin
  select * into v_policy from public.cancellation_policy_versions where id = b.policy_version_id;
  v_rules := coalesce(v_policy.rules, '{}'::jsonb);

  if b.status in ('active', 'overdue', 'return_requested', 'disputed') then
    return jsonb_build_object('allowed', false, 'rule', 'after_pickup',
      'reason', 'Once the item has been picked up, use Return item or Report a problem instead of cancelling.');
  end if;
  if b.status not in ('pending_lender_approval', 'awaiting_payment', 'confirmed') then
    return jsonb_build_object('allowed', false, 'rule', null, 'reason', 'This booking has already ended.');
  end if;
  if b.status = 'pending_lender_approval' and p_side = 'lender' then
    return jsonb_build_object('allowed', false, 'rule', null, 'reason', 'Decline the request instead.');
  end if;

  v_rule := case
    when p_side = 'staff' then 'listing_withdrawn'
    when b.status = 'pending_lender_approval' then 'pending_cancel_by_borrower'
    when p_side = 'lender' then 'lender_cancel_before_pickup'
    else 'borrower_cancel_before_pickup' end;

  if v_paid.id is not null then
    if v_rule = 'borrower_cancel_before_pickup' then
      -- Highest window the remaining time qualifies for; once the pickup day has started, the lowest window applies.
      select (w ->> 'rent_refund_pct')::numeric into v_rent_pct
        from jsonb_array_elements(coalesce(v_rules -> v_rule -> 'windows', '[]'::jsonb)) w
       where (w ->> 'min_hours_before_pickup')::numeric <= greatest(v_hours, 0)
       order by (w ->> 'min_hours_before_pickup')::numeric desc limit 1;
      v_rent_pct := coalesce(v_rent_pct, 100);
    else
      v_rent_pct := coalesce((v_rules -> v_rule ->> 'rent_refund_pct')::numeric, 100);
    end if;
    v_dep_pct := coalesce((v_rules -> v_rule ->> 'deposit_refund_pct')::numeric, 100);
    v_rent_refund := app_private.pct(b.subtotal, v_rent_pct);
    v_dep_refund := app_private.pct(b.deposit, v_dep_pct);
  end if;

  v_kept := case when v_paid.id is null then 0 else b.subtotal - v_rent_refund end;
  v_comm_after := app_private.commission_amount(v_kept, b.commission_bps);
  v_note := case
    when v_paid.id is null then 'Nothing has been charged, so there is nothing to refund.'
    when v_rent_pct >= 100 and v_dep_pct >= 100 then 'Everything paid is refunded (simulated).'
    else 'Under the ' || case when coalesce(v_policy.is_sample, true) then 'sample ' else '' end || 'policy, cancelling '
         || case when v_hours <= 0 then 'on the pickup day' else 'about ' || round(v_hours) || ' h before the pickup day' end
         || ' refunds ' || v_rent_pct || '% of the rent and ' || v_dep_pct || '% of the deposit. The rest of the rent goes to the lender as compensation, minus the platform commission.' end;

  return jsonb_build_object(
    'allowed', true, 'rule', v_rule, 'side', p_side,
    'policy_version', v_policy.version, 'policy_label', v_policy.label, 'policy_is_sample', coalesce(v_policy.is_sample, true),
    'paid', coalesce(v_paid.amount, 0), 'rent_paid', case when v_paid.id is null then 0 else b.subtotal end, 'deposit_paid', case when v_paid.id is null then 0 else b.deposit end,
    'rent_refund_pct', case when v_paid.id is null then null else v_rent_pct end, 'deposit_refund_pct', case when v_paid.id is null then null else v_dep_pct end,
    'rent_refund', v_rent_refund, 'deposit_refund', v_dep_refund, 'refund_total', v_rent_refund + v_dep_refund,
    'rent_kept', v_kept, 'commission_after', v_comm_after, 'lender_net_after', v_kept - v_comm_after,
    'hours_before_pickup', round(v_hours, 1), 'explanation', v_note);
end
$$;

create function app_private.caller_side(b public.bookings) returns text
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() = b.lender_id then 'lender' when auth.uid() = b.borrower_id then 'borrower'
              when app_private.is_staff() then 'staff' end
$$;

create function public.preview_cancellation(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings; v_side text;
begin
  select * into b from public.bookings where id = p_booking_id;
  v_side := case when b.id is null then null else app_private.caller_side(b) end;
  if auth.uid() is null or v_side is null then
    raise exception 'not_found.booking' using errcode = 'P0001', hint = 'This booking isn’t yours or no longer exists.';
  end if;
  return app_private.cancellation_quote(b, v_side);
end
$$;

create function public.cancel_booking(p_booking_id uuid, p_reason text default null, p_expected_refund bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_side text;
  q jsonb;
  v_reason text := app_private.check_note(p_reason, 300);
  v_title text;
  v_refund uuid;
  v_label text;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  v_side := case when b.id is null then null else app_private.caller_side(b) end;
  if auth.uid() is null or v_side is null then
    raise exception 'not_found.booking' using errcode = 'P0001', hint = 'This booking isn’t yours or no longer exists.';
  end if;
  if b.status = 'cancelled' and b.cancelled_by is not distinct from auth.uid() then
    return jsonb_build_object('status', 'cancelled', 'repeated', true);
  end if;
  q := app_private.cancellation_quote(b, v_side);
  if not (q ->> 'allowed')::boolean then
    raise exception 'conflict.cannot_cancel' using errcode = 'P0001', hint = q ->> 'reason';
  end if;
  if v_side in ('lender', 'staff') and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'validation.reason' using errcode = 'P0001', hint = 'Tell the borrower why you’re cancelling (3 to 300 characters).';
  end if;
  -- The refund the user saw must still apply (time windows can move between preview and confirm).
  if p_expected_refund is distinct from (q ->> 'refund_total')::bigint then
    raise exception 'conflict.refund_changed' using errcode = 'P0001', hint = 'The refund amount changed. Review the new amounts and confirm again.';
  end if;

  v_title := coalesce(b.snapshot ->> 'listing_title', 'the item');
  v_label := case v_side when 'borrower' then 'Cancelled by the borrower' when 'lender' then 'Cancelled by the lender' else 'Cancelled by TigRent' end;
  perform app_private.log_transition(b, 'cancelled', auth.uid(), coalesce(v_reason, v_label),
    jsonb_build_object('rule', q ->> 'rule', 'refund_total', (q ->> 'refund_total')::bigint, 'rent_refund', (q ->> 'rent_refund')::bigint,
                       'deposit_refund', (q ->> 'deposit_refund')::bigint, 'policy_version', q -> 'policy_version'));
  update public.bookings set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
    cancel_reason = coalesce(v_reason, v_label) where id = b.id;
  update public.extension_requests set status = 'cancelled' where booking_id = b.id and status in ('pending', 'approved_awaiting_payment');

  if (q ->> 'paid')::bigint > 0 then
    -- Deposit not refunded under the policy (if any) goes to the lender as a recorded cancellation adjustment.
    v_refund := app_private.settle_booking_money(b, (q ->> 'rent_refund')::bigint, b.deposit - (q ->> 'deposit_refund')::bigint,
      'cancellation_adjustment', 'booking:' || b.id || ':cancel', 'Cancellation refund (' || replace(q ->> 'rule', '_', ' ') || ')');
  end if;
  perform app_private.audit('booking.cancelled', 'booking', b.id::text, q || jsonb_build_object('by', v_side));

  perform app_private.notify(b.borrower_id, 'booking.cancelled', 'Booking cancelled',
    v_title || ' (' || app_private.short_dates(b.pickup_date, b.return_date) || '): ' || v_label || '. '
      || case when (q ->> 'refund_total')::bigint > 0 then app_private.peso((q ->> 'refund_total')::bigint) || ' refunded (simulated).' else 'Nothing was charged.' end,
    'booking', b.id, 'booking:' || b.id || ':cancelled:borrower');
  perform app_private.notify(b.lender_id, 'booking.cancelled', 'Booking cancelled',
    v_title || ' (' || app_private.short_dates(b.pickup_date, b.return_date) || '): ' || v_label || '. The dates are free again.'
      || case when (q ->> 'rent_kept')::bigint > 0 then ' You keep ' || app_private.peso((q ->> 'lender_net_after')::bigint) || ' under the cancellation policy (simulated).' else '' end,
    'booking', b.id, 'booking:' || b.id || ':cancelled:lender');
  return q || jsonb_build_object('status', 'cancelled', 'repeated', false, 'refund_id', v_refund);
end
$$;

-- ── Return with late fees (replaces migration 016 behaviour) ───────────────
-- Late fee = started late days × the agreed late fee, withheld from the deposit (capped at the deposit;
-- the prototype holds only the deposit). The rest of the deposit is released.
create or replace function public.confirm_clean_return(p_booking_id uuid, p_notes text default null, p_photo_paths text[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_side text;
  r public.return_reports;
  v_notes text := app_private.check_note(p_notes);
  v_photos text[];
  v_late integer;
  v_fee bigint;
  v_withheld bigint;
  v_title text;
begin
  b := app_private.lock_party_booking(p_booking_id);
  v_side := case when auth.uid() = b.lender_id then 'lender' else 'borrower' end;
  if v_side <> 'lender' then
    raise exception 'forbidden.lender_only' using errcode = 'P0001', hint = 'Only the lender inspects and confirms the return.';
  end if;
  if b.status = 'completed' then
    return jsonb_build_object('status', b.status, 'repeated', true);
  end if;
  if b.status <> 'return_requested' then
    raise exception 'conflict.no_return' using errcode = 'P0001', hint = 'The borrower hasn’t submitted the return yet.';
  end if;
  select * into r from public.return_reports where booking_id = b.id;
  v_late := app_private.late_days(b.due_at, r.borrower_requested_at);
  v_fee := v_late * b.late_fee_per_day; -- agreed fee from the booking, never the live listing
  v_withheld := least(v_fee, b.deposit);
  v_photos := app_private.check_evidence_paths(b.id, p_photo_paths);
  update public.return_reports set lender_inspected_at = now(), outcome = case when v_late > 0 then 'late' else 'clean' end::public.return_outcome,
    lender_notes = v_notes, lender_photo_paths = v_photos, late_days = v_late, late_fee = v_fee where booking_id = b.id;
  perform app_private.log_transition(b, 'completed', auth.uid(), coalesce(v_notes, 'Returned in the agreed condition'),
    jsonb_build_object('late_days', v_late, 'late_fee', v_fee, 'late_fee_withheld', v_withheld));
  update public.bookings set status = 'completed', completed_at = now() where id = b.id;
  perform app_private.settle_booking_money(b, 0, v_withheld, 'late_fee', 'booking:' || b.id || ':return',
    case when v_withheld > 0 then 'Late fee: ' || v_late || ' day(s) × ' || app_private.peso(b.late_fee_per_day) else 'Deposit released after clean return' end);

  v_title := coalesce(b.snapshot ->> 'listing_title', 'the item');
  perform app_private.notify(b.borrower_id, 'booking.completed', 'Rental complete',
    'The lender confirmed ' || v_title || ' came back in good condition.'
      || case when v_withheld > 0 then ' It was ' || v_late || ' day' || case when v_late = 1 then '' else 's' end || ' late, so '
              || app_private.peso(v_withheld) || ' late fee was taken from your deposit' else '' end
      || case when b.deposit - v_withheld > 0 then case when v_withheld > 0 then ' and ' else ' Your ' end || app_private.peso(b.deposit - v_withheld) || ' was released (simulated refund).' else '.' end,
    'booking', b.id, 'booking:' || b.id || ':completed:borrower');
  perform app_private.notify(b.lender_id, 'booking.completed', 'Rental complete',
    v_title || ' is back and available for new bookings.' || case when v_withheld > 0 then ' Late fee ' || app_private.peso(v_withheld) || ' added to your simulated earnings.' else '' end,
    'booking', b.id, 'booking:' || b.id || ':completed:lender');
  return jsonb_build_object('status', 'completed', 'repeated', false, 'late_days', v_late, 'late_fee', v_fee,
                            'late_fee_withheld', v_withheld, 'late_fee_uncollected', v_fee - v_withheld, 'deposit_released', b.deposit - v_withheld);
end
$$;

-- ── Disputes (plan §2.7) ───────────────────────────────────────────────────
create function app_private.add_dispute_evidence(p_dispute uuid, p_booking uuid, p_paths text[], p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_paths text[] := app_private.check_evidence_paths(p_booking, p_paths); p text;
begin
  foreach p in array v_paths loop
    insert into public.dispute_evidence (dispute_id, uploaded_by, path, mime, size_bytes, note)
    select p_dispute, auth.uid(), p, o.metadata ->> 'mimetype', nullif((o.metadata ->> 'size')::int, 0), left(p_note, 500)
      from storage.objects o where o.bucket_id = 'evidence' and o.name = p;
  end loop;
end
$$;

-- Opens a dispute and moves the booking to `disputed` (deposit stays held until a moderator decides).
create function app_private.open_dispute_for(b public.bookings, p_side text, p_category public.dispute_category, p_severity public.dispute_severity,
                                             p_description text, p_requested bigint, p_photos text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_desc text := trim(coalesce(p_description, ''));
  v_title text := coalesce(b.snapshot ->> 'listing_title', 'the item');
begin
  if char_length(v_desc) not between 10 and 2000 then
    raise exception 'validation.description' using errcode = 'P0001', hint = 'Describe what happened in 10 to 2,000 characters.';
  end if;
  if p_requested is null or p_requested < 0 then
    raise exception 'validation.requested_amount' using errcode = 'P0001', hint = 'Enter the amount you’re asking for (₱0 or more).';
  end if;
  if exists (select 1 from public.disputes where booking_id = b.id and status not in ('resolved_refund', 'resolved_compensation', 'closed')) then
    raise exception 'conflict.dispute_open' using errcode = 'P0001', hint = 'A dispute is already open for this booking.';
  end if;
  insert into public.disputes (booking_id, opener_id, category, severity, description, requested_amount, status)
  values (b.id, auth.uid(), p_category, p_severity, v_desc, p_requested,
          (case when p_side = 'lender' then 'awaiting_borrower_response' else 'awaiting_lender_response' end)::public.dispute_status)
  returning id into v_id;
  perform app_private.add_dispute_evidence(v_id, b.id, p_photos, 'Submitted with the report');
  perform app_private.log_transition(b, 'disputed', auth.uid(), 'Dispute opened: ' || replace(p_category::text, '_', ' '), jsonb_build_object('dispute_id', v_id));
  update public.bookings set status = 'disputed' where id = b.id;
  update public.extension_requests set status = 'cancelled' where booking_id = b.id and status in ('pending', 'approved_awaiting_payment');
  perform app_private.notify(case when p_side = 'lender' then b.borrower_id else b.lender_id end, 'dispute.opened', 'A problem was reported',
    'The ' || p_side || ' reported a problem with ' || v_title || ' (' || replace(p_category::text, '_', ' ') || '). Add your side and any photos; a TigRent moderator decides.',
    'dispute', v_id, 'dispute:' || v_id || ':opened:other');
  perform app_private.notify(auth.uid(), 'dispute.opened', 'Report sent',
    'Your report about ' || v_title || ' is with the other party and TigRent moderators. The deposit stays held until a decision.',
    'dispute', v_id, 'dispute:' || v_id || ':opened:self');
  perform app_private.notify_staff('dispute.opened', 'New dispute', replace(p_category::text, '_', ' ') || ' · ' || v_title, 'dispute', v_id, 'dispute:' || v_id || ':opened:staff');
  perform app_private.audit('dispute.opened', 'dispute', v_id::text, jsonb_build_object('booking_id', b.id, 'category', p_category, 'requested_amount', p_requested));
  return v_id;
end
$$;

-- Lender: inspection found damage or missing parts (instead of a clean return).
create function public.report_return_problem(p_booking_id uuid, p_outcome text, p_description text, p_requested_amount bigint, p_photo_paths text[] default '{}') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  r public.return_reports;
  v_late integer;
  v_id uuid;
begin
  b := app_private.lock_party_booking(p_booking_id);
  if auth.uid() <> b.lender_id then
    raise exception 'forbidden.lender_only' using errcode = 'P0001', hint = 'Only the lender inspects the return.';
  end if;
  if b.status <> 'return_requested' then
    raise exception 'conflict.no_return' using errcode = 'P0001', hint = 'The borrower hasn’t submitted the return yet.';
  end if;
  if p_outcome is null or p_outcome not in ('damaged', 'incomplete') then
    raise exception 'validation.outcome' using errcode = 'P0001', hint = 'Choose damaged or incomplete.';
  end if;
  if p_requested_amount > b.deposit then
    raise exception 'validation.requested_amount' using errcode = 'P0001', hint = 'You can claim up to the ' || app_private.peso(b.deposit) || ' deposit TigRent holds.';
  end if;
  select * into r from public.return_reports where booking_id = b.id;
  v_late := app_private.late_days(b.due_at, r.borrower_requested_at);
  update public.return_reports set lender_inspected_at = now(), outcome = p_outcome::public.return_outcome, lender_notes = left(trim(p_description), 1000),
    lender_photo_paths = coalesce(p_photo_paths, '{}'), late_days = v_late, late_fee = v_late * b.late_fee_per_day where booking_id = b.id;
  v_id := app_private.open_dispute_for(b, 'lender', case p_outcome when 'damaged' then 'damage' else 'incomplete_return' end::public.dispute_category,
                                       'major', p_description, p_requested_amount, p_photo_paths);
  return v_id;
end
$$;

-- Lender escalation for an overdue item (never automatic, plan §2.7).
create function public.report_not_returned(p_booking_id uuid, p_description text, p_requested_amount bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  b := app_private.lock_party_booking(p_booking_id);
  if auth.uid() <> b.lender_id then
    raise exception 'forbidden.lender_only' using errcode = 'P0001', hint = 'Only the lender can report an item as not returned.';
  end if;
  if b.status <> 'overdue' then
    raise exception 'conflict.not_overdue' using errcode = 'P0001', hint = 'You can report this only after the due time has passed.';
  end if;
  if p_requested_amount > b.deposit then
    raise exception 'validation.requested_amount' using errcode = 'P0001', hint = 'You can claim up to the ' || app_private.peso(b.deposit) || ' deposit TigRent holds.';
  end if;
  return app_private.open_dispute_for(b, 'lender', 'missing_item', 'severe', p_description, p_requested_amount, '{}');
end
$$;

-- Borrower: the item isn't as described, or another problem during the rental.
create function public.open_dispute(p_booking_id uuid, p_category text, p_description text, p_requested_amount bigint default 0, p_photo_paths text[] default '{}') returns uuid
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  b := app_private.lock_party_booking(p_booking_id);
  if auth.uid() <> b.borrower_id then
    raise exception 'forbidden.borrower_only' using errcode = 'P0001', hint = 'Lenders report problems from the return inspection or an overdue rental.';
  end if;
  if b.status not in ('active', 'overdue', 'return_requested') then
    raise exception 'conflict.not_disputable' using errcode = 'P0001', hint = 'Problems can be reported while the item is out on rent or being returned.';
  end if;
  if p_category is null or p_category not in ('not_as_described', 'payment', 'other') then
    raise exception 'validation.category' using errcode = 'P0001', hint = 'Choose what the problem is about.';
  end if;
  if p_requested_amount > b.subtotal then
    raise exception 'validation.requested_amount' using errcode = 'P0001', hint = 'You can ask for up to the ' || app_private.peso(b.subtotal) || ' rent you paid.';
  end if;
  return app_private.open_dispute_for(b, 'borrower', p_category::public.dispute_category, 'major', p_description, coalesce(p_requested_amount, 0), p_photo_paths);
end
$$;

create function public.respond_to_dispute(p_dispute_id uuid, p_body text, p_photo_paths text[] default '{}', p_request_from text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.disputes;
  b public.bookings;
  v_side text;
  v_body text := trim(coalesce(p_body, ''));
  v_next public.dispute_status;
begin
  select * into d from public.disputes where id = p_dispute_id for update;
  if d.id is null then
    raise exception 'not_found.dispute' using errcode = 'P0001', hint = 'This case isn’t available.';
  end if;
  select * into b from public.bookings where id = d.booking_id;
  v_side := app_private.caller_side(b);
  if auth.uid() is null or v_side is null then
    raise exception 'not_found.dispute' using errcode = 'P0001', hint = 'This case isn’t available.';
  end if;
  if d.status in ('resolved_refund', 'resolved_compensation', 'closed') then
    raise exception 'conflict.dispute_decided' using errcode = 'P0001', hint = 'This case has been decided. You can appeal the decision instead.';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'validation.body' using errcode = 'P0001', hint = 'Write a reply of up to 2,000 characters.';
  end if;
  insert into public.dispute_messages (dispute_id, sender_id, body) values (d.id, auth.uid(), v_body);
  if v_side <> 'staff' then
    perform app_private.add_dispute_evidence(d.id, b.id, p_photo_paths, left(v_body, 200));
  end if;
  v_next := case
    when v_side = 'staff' and p_request_from = 'borrower' then 'awaiting_borrower_response'
    when v_side = 'staff' and p_request_from = 'lender' then 'awaiting_lender_response'
    when v_side = 'staff' then d.status
    when d.status = 'appealed' then 'appealed'
    when (d.status = 'awaiting_borrower_response' and v_side = 'borrower') or (d.status = 'awaiting_lender_response' and v_side = 'lender') then 'under_review'
    else d.status end;
  update public.disputes set status = v_next where id = d.id;
  if v_side in ('borrower', 'staff') then
    perform app_private.notify(b.lender_id, 'dispute.response', case when v_side = 'staff' then 'Message from a TigRent moderator' else 'New reply in your case' end,
      left(v_body, 140), 'dispute', d.id, 'dispute:' || d.id || ':msg:' || (select count(*) from public.dispute_messages where dispute_id = d.id) || ':lender');
  end if;
  if v_side in ('lender', 'staff') then
    perform app_private.notify(b.borrower_id, 'dispute.response', case when v_side = 'staff' then 'Message from a TigRent moderator' else 'New reply in your case' end,
      left(v_body, 140), 'dispute', d.id, 'dispute:' || d.id || ':msg:' || (select count(*) from public.dispute_messages where dispute_id = d.id) || ':borrower');
  end if;
  if v_next = 'under_review' and d.status <> 'under_review' then
    perform app_private.notify_staff('dispute.ready', 'Dispute ready for review', 'Both sides have responded.', 'dispute', d.id, 'dispute:' || d.id || ':ready');
  end if;
end
$$;

-- Moderator decision: how much of the deposit goes to the lender, any rent refund, and how the booking ends.
create function public.resolve_dispute(p_dispute_id uuid, p_deposit_to_lender bigint, p_rent_refund bigint, p_booking_outcome text, p_decision text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.disputes;
  b public.bookings;
  v_decision text := trim(coalesce(p_decision, ''));
  v_status public.dispute_status;
  v_category public.ledger_category;
  v_title text;
begin
  if not app_private.is_staff() then
    raise exception 'forbidden.staff_only' using errcode = 'P0001', hint = 'Only TigRent moderators decide disputes.';
  end if;
  select * into d from public.disputes where id = p_dispute_id for update;
  if d.id is null then
    raise exception 'not_found.dispute' using errcode = 'P0001', hint = 'This case isn’t available.';
  end if;
  if d.status in ('resolved_refund', 'resolved_compensation', 'closed') then
    return jsonb_build_object('status', d.status, 'repeated', true);
  end if;
  if d.status = 'appealed' then
    raise exception 'conflict.appealed' using errcode = 'P0001', hint = 'Use the appeal review for this case.';
  end if;
  if char_length(v_decision) not between 10 and 2000 then
    raise exception 'validation.decision' using errcode = 'P0001', hint = 'Explain the decision to both parties (10 to 2,000 characters).';
  end if;
  if p_booking_outcome is null or p_booking_outcome not in ('completed', 'cancelled') then
    raise exception 'validation.booking_outcome' using errcode = 'P0001', hint = 'Choose whether the rental is completed or cancelled.';
  end if;
  select * into b from public.bookings where id = d.booking_id for update;
  if b.status <> 'disputed' then
    raise exception 'conflict.not_disputed' using errcode = 'P0001', hint = 'The booking is not in dispute.';
  end if;
  v_category := case when d.category = 'late_return' then 'late_fee' else 'damage_compensation' end::public.ledger_category;
  perform app_private.settle_booking_money(b, coalesce(p_rent_refund, 0), coalesce(p_deposit_to_lender, 0), v_category,
    'dispute:' || d.id || ':resolve', 'Dispute decision: ' || left(v_decision, 200));
  v_status := case when coalesce(p_deposit_to_lender, 0) > 0 then 'resolved_compensation'
                   when coalesce(p_rent_refund, 0) > 0 or b.deposit > 0 then 'resolved_refund' else 'closed' end;
  update public.disputes set status = v_status, decision = v_decision, resolution_amount = coalesce(p_deposit_to_lender, 0),
    decided_by = auth.uid(), decided_at = now() where id = d.id;
  perform app_private.log_transition(b, p_booking_outcome::public.booking_status, auth.uid(), 'Dispute decided by a moderator',
    jsonb_build_object('dispute_id', d.id, 'deposit_to_lender', p_deposit_to_lender, 'rent_refund', p_rent_refund));
  update public.bookings set status = p_booking_outcome::public.booking_status,
    completed_at = case when p_booking_outcome = 'completed' then now() else completed_at end,
    cancelled_at = case when p_booking_outcome = 'cancelled' then now() else cancelled_at end,
    cancel_reason = case when p_booking_outcome = 'cancelled' then 'Cancelled after a dispute decision' else cancel_reason end
  where id = b.id;
  perform app_private.audit('dispute.resolved', 'dispute', d.id::text,
    jsonb_build_object('deposit_to_lender', p_deposit_to_lender, 'rent_refund', p_rent_refund, 'booking_outcome', p_booking_outcome));
  v_title := coalesce(b.snapshot ->> 'listing_title', 'the item');
  perform app_private.notify(b.borrower_id, 'dispute.resolved', 'Decision on your case',
    v_title || ': ' || case when coalesce(p_deposit_to_lender, 0) > 0 then app_private.peso(p_deposit_to_lender) || ' of the deposit goes to the lender. ' else '' end
      || case when b.deposit - coalesce(p_deposit_to_lender, 0) + coalesce(p_rent_refund, 0) > 0 then app_private.peso(b.deposit - coalesce(p_deposit_to_lender, 0) + coalesce(p_rent_refund, 0)) || ' refunded to you (simulated). ' else '' end
      || 'Open the case to read the reasons or appeal.',
    'dispute', d.id, 'dispute:' || d.id || ':resolved:borrower');
  perform app_private.notify(b.lender_id, 'dispute.resolved', 'Decision on your case',
    v_title || ': ' || case when coalesce(p_deposit_to_lender, 0) > 0 then app_private.peso(p_deposit_to_lender) || ' of the deposit is added to your simulated earnings. ' else 'No deposit is withheld. ' end
      || 'Open the case to read the reasons or appeal.',
    'dispute', d.id, 'dispute:' || d.id || ':resolved:lender');
  return jsonb_build_object('status', v_status, 'repeated', false);
end
$$;

create function public.appeal_dispute(p_dispute_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.disputes;
  b public.bookings;
  v_reason text := trim(coalesce(p_reason, ''));
  v_days integer := coalesce((app_private.setting('dispute_appeal_days'))::int, 7);
begin
  select * into d from public.disputes where id = p_dispute_id for update;
  select * into b from public.bookings where id = d.booking_id;
  if d.id is null or auth.uid() not in (b.borrower_id, b.lender_id) then
    raise exception 'not_found.dispute' using errcode = 'P0001', hint = 'This case isn’t available.';
  end if;
  if d.status not in ('resolved_refund', 'resolved_compensation', 'closed') or d.decided_at is null then
    raise exception 'conflict.not_decided' using errcode = 'P0001', hint = 'You can appeal only after a decision.';
  end if;
  if exists (select 1 from public.dispute_messages where dispute_id = d.id and body like 'Appeal: %') then
    raise exception 'conflict.already_appealed' using errcode = 'P0001', hint = 'This decision has already been appealed once.';
  end if;
  if now() > d.decided_at + make_interval(days => v_days) then
    raise exception 'conflict.appeal_window' using errcode = 'P0001', hint = 'The ' || v_days || '-day appeal window has closed.';
  end if;
  if char_length(v_reason) not between 10 and 2000 then
    raise exception 'validation.reason' using errcode = 'P0001', hint = 'Explain why the decision should be reviewed (10 to 2,000 characters).';
  end if;
  insert into public.dispute_messages (dispute_id, sender_id, body) values (d.id, auth.uid(), 'Appeal: ' || v_reason);
  update public.disputes set status = 'appealed' where id = d.id;
  perform app_private.notify_staff('dispute.appealed', 'Dispute decision appealed', left(v_reason, 140), 'dispute', d.id, 'dispute:' || d.id || ':appealed:staff');
  perform app_private.notify(case when auth.uid() = b.borrower_id then b.lender_id else b.borrower_id end, 'dispute.appealed', 'Decision appealed',
    'The other party appealed the decision. A moderator will review it.', 'dispute', d.id, 'dispute:' || d.id || ':appealed:other');
end
$$;

-- Appeal review: upholds the decision with a recorded note (money already moved stays as decided; any
-- correction is recorded here and handled manually in this prototype).
create function public.decide_appeal(p_dispute_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.disputes; b public.bookings; v_note text := trim(coalesce(p_note, ''));
begin
  if not app_private.is_staff() then
    raise exception 'forbidden.staff_only' using errcode = 'P0001', hint = 'Only TigRent moderators review appeals.';
  end if;
  select * into d from public.disputes where id = p_dispute_id for update;
  if d.id is null or d.status <> 'appealed' then
    raise exception 'conflict.not_appealed' using errcode = 'P0001', hint = 'There is no open appeal on this case.';
  end if;
  if char_length(v_note) not between 10 and 2000 then
    raise exception 'validation.note' using errcode = 'P0001', hint = 'Explain the appeal outcome (10 to 2,000 characters).';
  end if;
  select * into b from public.bookings where id = d.booking_id;
  insert into public.dispute_messages (dispute_id, sender_id, body) values (d.id, auth.uid(), 'Appeal reviewed: ' || v_note);
  update public.disputes set status = 'closed', decision = coalesce(decision, '') || E'\n\nAppeal reviewed: ' || v_note where id = d.id;
  perform app_private.audit('dispute.appeal_decided', 'dispute', d.id::text, jsonb_build_object('note', v_note));
  perform app_private.notify(b.borrower_id, 'dispute.appeal_decided', 'Appeal reviewed', left(v_note, 300), 'dispute', d.id, 'dispute:' || d.id || ':appeal_decided:borrower');
  perform app_private.notify(b.lender_id, 'dispute.appeal_decided', 'Appeal reviewed', left(v_note, 300), 'dispute', d.id, 'dispute:' || d.id || ':appeal_decided:lender');
end
$$;

create function public.get_dispute(p_dispute_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d public.disputes;
  b public.bookings;
  r public.return_reports;
  v_side text;
  v_days integer := coalesce((app_private.setting('dispute_appeal_days'))::int, 7);
  v_late integer;
begin
  select * into d from public.disputes where id = p_dispute_id;
  if d.id is not null then
    select * into b from public.bookings where id = d.booking_id;
    v_side := app_private.caller_side(b);
  end if;
  if auth.uid() is null or v_side is null then
    raise exception 'not_found.dispute' using errcode = 'P0001', hint = 'This case isn’t available.';
  end if;
  select * into r from public.return_reports where booking_id = b.id;
  v_late := app_private.late_days(b.due_at, coalesce(r.borrower_requested_at, case when b.status in ('overdue', 'disputed') then now() end));
  return jsonb_build_object(
    'id', d.id, 'booking_id', b.id, 'my_role', v_side, 'category', d.category, 'severity', d.severity, 'status', d.status,
    'description', d.description, 'requested_amount', d.requested_amount, 'decision', d.decision, 'resolution_amount', d.resolution_amount,
    'decided_at', d.decided_at, 'created_at', d.created_at,
    'opened_by', case when d.opener_id = b.lender_id then 'lender' when d.opener_id = b.borrower_id then 'borrower' else 'staff' end,
    'appeal_deadline', case when d.decided_at is not null then d.decided_at + make_interval(days => v_days) end,
    'can_appeal', v_side in ('borrower', 'lender') and d.status in ('resolved_refund', 'resolved_compensation', 'closed') and d.decided_at is not null
                  and now() <= d.decided_at + make_interval(days => v_days)
                  and not exists (select 1 from public.dispute_messages m where m.dispute_id = d.id and m.body like 'Appeal: %'),
    'booking', jsonb_build_object('status', b.status, 'listing_title', b.snapshot ->> 'listing_title', 'pickup_date', b.pickup_date, 'return_date', b.return_date,
      'due_at', b.due_at, 'subtotal', b.subtotal, 'deposit', b.deposit, 'late_fee_per_day', b.late_fee_per_day, 'late_days', v_late,
      'late_fee', v_late * b.late_fee_per_day, 'paid', coalesce((app_private.booking_payment(b.id)).amount, 0),
      'return_outcome', r.outcome, 'returned_at', r.borrower_requested_at),
    'borrower', jsonb_build_object('id', b.borrower_id, 'full_name', (select full_name from public.profiles where id = b.borrower_id)),
    'lender', jsonb_build_object('id', b.lender_id, 'full_name', (select full_name from public.profiles where id = b.lender_id)),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'at', m.created_at, 'by_me', m.sender_id = auth.uid(),
        'sender_role', case when m.sender_id = b.lender_id then 'lender' when m.sender_id = b.borrower_id then 'borrower' else 'staff' end) order by m.created_at, m.id)
      from public.dispute_messages m where m.dispute_id = d.id), '[]'::jsonb),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'path', e.path, 'note', e.note, 'at', e.created_at,
        'by_role', case when e.uploaded_by = b.lender_id then 'lender' when e.uploaded_by = b.borrower_id then 'borrower' else 'staff' end) order by e.created_at)
      from public.dispute_evidence e where e.dispute_id = d.id), '[]'::jsonb)
      -- Photos recorded at return/handover are evidence too.
      || coalesce((select jsonb_agg(jsonb_build_object('id', null, 'path', x.p, 'note', x.note, 'at', null, 'by_role', x.who))
           from (select unnest(r.borrower_photo_paths) p, 'Return photo' note, 'borrower' who
                 union all select unnest(r.lender_photo_paths), 'Inspection photo', 'lender') x
          where not exists (select 1 from public.dispute_evidence e2 where e2.dispute_id = d.id and e2.path = x.p)), '[]'::jsonb));
end
$$;

create function public.list_disputes(p_open_only boolean default true) returns table (
  id uuid, booking_id uuid, listing_title text, category public.dispute_category, severity public.dispute_severity, status public.dispute_status,
  requested_amount bigint, borrower_name text, lender_name text, created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  return query
    select d.id, b.id, coalesce(b.snapshot ->> 'listing_title', ''), d.category, d.severity, d.status, d.requested_amount,
           (select pb.full_name from public.profiles pb where pb.id = b.borrower_id), (select pl.full_name from public.profiles pl where pl.id = b.lender_id),
           d.created_at, d.updated_at
      from public.disputes d join public.bookings b on b.id = d.booking_id
     where (app_private.is_staff() or auth.uid() in (b.borrower_id, b.lender_id))
       and (not coalesce(p_open_only, true) or d.status not in ('resolved_refund', 'resolved_compensation', 'closed'))
     order by case d.status when 'appealed' then 0 when 'under_review' then 1 when 'open' then 2 else 3 end,
              case d.severity when 'severe' then 0 when 'major' then 1 else 2 end, d.created_at
     limit 200;
end
$$;

-- get_booking_detail (migration 016) + the latest dispute and the live late-fee estimate.
create or replace function public.get_booking_detail(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  b public.bookings;
  v_role text;
  v_other uuid;
  v_other_rating record;
  h public.handover_reports;
  r public.return_reports;
  v_early integer := greatest(0, coalesce((app_private.setting('handover_opens_days_before'))::int, 1));
  v_late integer;
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
  select * into h from public.handover_reports where booking_id = b.id;
  select * into r from public.return_reports where booking_id = b.id;
  v_late := case when b.status in ('active', 'overdue') then app_private.late_days(b.due_at, now())
                 when b.status in ('return_requested', 'disputed', 'completed') then coalesce(r.late_days, app_private.late_days(b.due_at, r.borrower_requested_at), 0)
                 else 0 end;

  return jsonb_build_object(
    'id', b.id, 'my_role', v_role, 'status', b.status, 'listing_id', b.listing_id,
    'listing_status', (select status from public.listings where id = b.listing_id),
    'pickup_date', b.pickup_date, 'return_date', b.return_date, 'rental_days', b.rental_days, 'due_at', b.due_at,
    'pickup_arrangement', b.pickup_arrangement, 'snapshot', b.snapshot,
    'daily_rate', b.daily_rate, 'subtotal', b.subtotal, 'deposit', b.deposit, 'total', b.total, 'late_fee_per_day', b.late_fee_per_day,
    'commission_bps', b.commission_bps, 'commission', b.commission, 'lender_net', b.lender_net,
    'hold_expires_at', b.hold_expires_at, 'server_now', now(),
    'decision_reason', b.decision_reason, 'decided_at', b.decided_at, 'cancel_reason', b.cancel_reason, 'cancelled_at', b.cancelled_at,
    'created_at', b.created_at, 'activated_at', b.activated_at, 'returned_at', b.returned_at, 'completed_at', b.completed_at,
    'handover_opens_on', b.pickup_date - v_early,
    'late_days_now', v_late,
    'late_fee_now', v_late * b.late_fee_per_day,
    'conflict', case when v_role in ('lender', 'staff') then app_private.request_conflict(b) end,
    'conversation_id', (select c.id from public.conversations c where c.booking_id = b.id),
    'dispute', (select jsonb_build_object('id', d.id, 'status', d.status, 'category', d.category) from public.disputes d
                 where d.booking_id = b.id order by d.created_at desc limit 1),
    'counterpart', jsonb_build_object(
      'id', v_other, 'role', case when v_role = 'lender' then 'borrower' else 'lender' end,
      'full_name', (select full_name from public.profiles where id = v_other),
      'is_student_verified', app_private.verification_status(v_other) = 'verified',
      'rating_avg', v_other_rating.avg, 'rating_count', coalesce(v_other_rating.count, 0)),
    'terms', (select jsonb_build_object('title', tv.title, 'version', tv.version, 'is_sample', tv.is_sample, 'accepted_at', t.accepted_at)
                from public.booking_terms_acceptances t join public.terms_versions tv on tv.id = t.terms_version_id
               where t.booking_id = b.id and t.user_id = b.borrower_id),
    'handover', case when h.booking_id is null then null else jsonb_build_object(
      'lender_confirmed_at', h.lender_confirmed_at, 'lender_notes', h.lender_notes,
      'borrower_confirmed_at', h.borrower_confirmed_at, 'borrower_notes', h.borrower_notes, 'photo_paths', to_jsonb(h.photo_paths)) end,
    'return', case when r.booking_id is null then null else jsonb_build_object(
      'requested_at', r.borrower_requested_at, 'borrower_notes', r.borrower_notes, 'borrower_photo_paths', to_jsonb(r.borrower_photo_paths),
      'inspected_at', r.lender_inspected_at, 'outcome', r.outcome, 'lender_notes', r.lender_notes, 'lender_photo_paths', to_jsonb(r.lender_photo_paths),
      'late_days', r.late_days, 'late_fee', r.late_fee) end,
    'extensions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'status', e.status, 'old_return_date', e.old_return_date, 'new_return_date', e.new_return_date, 'extra_days', e.extra_days,
        'extra_amount', e.extra_amount, 'extra_commission', e.extra_commission, 'hold_expires_at', e.hold_expires_at,
        'decision_reason', e.decision_reason, 'created_at', e.created_at, 'decided_at', e.decided_at,
        'conflict', case when e.status = 'pending' and v_role in ('lender', 'staff') then app_private.extension_conflict(b, e.new_return_date) end)
        order by e.created_at desc)
      from public.extension_requests e where e.booking_id = b.id), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'amount', f.amount, 'reason', f.reason, 'status', f.status, 'processed_at', f.processed_at) order by f.created_at)
                           from public.refunds f where f.booking_id = b.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('from_status', e.from_status, 'to_status', e.to_status, 'reason', e.reason,
                                                            'kind', e.metadata ->> 'kind', 'meta', e.metadata,
                                                            'by_me', e.actor_id = v_me, 'at', e.created_at) order by e.created_at, e.id)
                          from public.booking_events e where e.booking_id = b.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'purpose', p.purpose, 'status', p.status, 'amount', p.amount, 'provider', p.provider,
                                                              'provider_ref', p.provider_ref, 'failure_reason', p.failure_reason,
                                                              'processed_at', p.processed_at, 'created_at', p.created_at) order by p.created_at)
                            from public.payments p where p.booking_id = b.id and p.purpose in ('booking', 'extension')), '[]'::jsonb));
end
$$;

-- Lender earnings (simulated): payables net of adjustments, plus late fees and damage compensation.
create function public.my_lender_earnings() returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(credit - debit), 0)::bigint from public.ledger_entries
   where party_id = auth.uid() and category in ('rent_payable', 'cancellation_adjustment', 'late_fee', 'damage_compensation')
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────
revoke all on function
  public.preview_cancellation(uuid), public.cancel_booking(uuid, text, bigint),
  public.report_return_problem(uuid, text, text, bigint, text[]), public.report_not_returned(uuid, text, bigint),
  public.open_dispute(uuid, text, text, bigint, text[]), public.respond_to_dispute(uuid, text, text[], text),
  public.resolve_dispute(uuid, bigint, bigint, text, text), public.appeal_dispute(uuid, text), public.decide_appeal(uuid, text),
  public.get_dispute(uuid), public.list_disputes(boolean), public.my_lender_earnings()
from public, anon;
grant execute on function
  public.preview_cancellation(uuid), public.cancel_booking(uuid, text, bigint),
  public.report_return_problem(uuid, text, text, bigint, text[]), public.report_not_returned(uuid, text, bigint),
  public.open_dispute(uuid, text, text, bigint, text[]), public.respond_to_dispute(uuid, text, text[], text),
  public.resolve_dispute(uuid, bigint, bigint, text, text), public.appeal_dispute(uuid, text), public.decide_appeal(uuid, text),
  public.get_dispute(uuid), public.list_disputes(boolean), public.my_lender_earnings()
to authenticated;
revoke execute on function
  app_private.pct(bigint, numeric),
  app_private.post_ledger(uuid, uuid, uuid, uuid, public.ledger_category, bigint, bigint, text, text),
  app_private.booking_payment(uuid),
  app_private.settle_booking_money(public.bookings, bigint, bigint, public.ledger_category, text, text),
  app_private.cancellation_quote(public.bookings, text),
  app_private.caller_side(public.bookings),
  app_private.add_dispute_evidence(uuid, uuid, text[], text),
  app_private.open_dispute_for(public.bookings, text, public.dispute_category, public.dispute_severity, text, bigint, text[])
from public, authenticated;
